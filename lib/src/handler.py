from io import BytesIO
from datetime import datetime
import boto3
from datetime import datetime, timedelta
import json
import os
import subprocess
import sys
from collections import defaultdict


def install_packages():
    subprocess.check_call([sys.executable, "-m", "pip",
                          "install", "--target", "/tmp", "pyarrow"])
    sys.path.append('/tmp')


install_packages()

import pyarrow as pa
import pyarrow.parquet as pq


metrics_period_in_seconds = int(os.environ['METRICS_PERIOD_IN_SECONDS'])
metrics_s3_prefix = os.environ['METRICS_S3_PREFIX']
# the number of hours to get performance insights data.
# default 1 hour, can be used to initially load past data
hour_delta = int(os.environ.get("DELTA_HOUR") or 1)


def lambda_handler(event, context):
    # Create EC2 client to list regions
    ec2_client = boto3.client('ec2')
    
    # Get all active AWS regions
    regions = [region['RegionName'] for region in ec2_client.describe_regions()['Regions']]
    
    # Create S3 and Performance Insights clients
    s3_client = boto3.client('s3')
    
    # Dictionary to accumulate metrics across all instances in a region
    region_metrics = {}
    
    # Iterate through all regions
    for region in regions:
        try:
            # Create region-specific RDS and Performance Insights clients
            rds_client = boto3.client('rds', region_name=region)
            pi_client = boto3.client('pi', region_name=region)
            
            # Get RDS instances in this region
            rds_instances = get_rds_instances(rds_client)
            
            # Initialize metrics for this region if not already present
            if region not in region_metrics:
                region_metrics[region] = []
            
            # Process each RDS instance
            for instance in rds_instances:
                instance_id = instance['DbiResourceId']
                instance_arn = instance['DBInstanceArn']
                print(f"Processing metrics for instance {instance_arn} in region {region}")

                # Check if Performance Insights is enabled
                if instance.get('PerformanceInsightsEnabled', False):
                    # Get Performance Insights metrics
                    metrics = get_performance_metrics(pi_client, instance_id)

                    # Collect metrics for this instance
                    region_metrics[region].extend(
                        process_metrics(instance_id, instance_arn, metrics, region)
                    )
                else:
                    print(f"Performance Insights not enabled for instance {instance_id} in {region}")
        
        except Exception as e:
            print(f"Error processing region {region}: {str(e)}")
    
    # Write accumulated metrics to S3
    write_metrics_to_s3(s3_client, region_metrics)
    
    return {
        'statusCode': 200,
        'body': json.dumps(f'Processed RDS instances across {len(regions)} regions')
    }


def get_rds_instances(rds_client):
    instances = []
    paginator = rds_client.get_paginator('describe_db_instances')

    for page in paginator.paginate():
        instances.extend(page['DBInstances'])

    return instances


def get_performance_metrics(pi_client, instance_id):
    current_time = datetime.utcnow()
    end_time = current_time.replace(minute=0, second=0, microsecond=0)
    start_time = end_time - timedelta(hours=hour_delta)

    response = pi_client.get_resource_metrics(
        ServiceType='RDS',
        Identifier=instance_id,
        MetricQueries=[
            {
                'Metric': 'os.general.numVCPUs.avg'
            },
            {
                'Metric': 'db.load.avg',
                'GroupBy': {
                    'Group': 'db.user',
                    'Dimensions': ['db.user.name']
                }
            },
        ],
        StartTime=start_time,
        EndTime=end_time,
        PeriodInSeconds=metrics_period_in_seconds
    )

    return response['MetricList']


def process_metrics(instance_id, instance_arn, metrics, region):
    all_flattened_metrics = []
    num_cpus = ''

    print(f"Processing metrics for instance {instance_id} in region {region}")
    print(f"Total metrics received: {len(metrics)}")

    for metric in metrics:
        # Debug print for each metric
        print(f"Processing metric: {metric['Key']['Metric']}")

        if metric["Key"]["Metric"] == 'os.general.numVCPUs.avg':
            for datapoint in metric["DataPoints"]:
                num_cpus = datapoint.get("Value", 0)
                if num_cpus != '':
                    break

        if "Dimensions" in metric["Key"]:
            base_entry = {
                "metric": metric["Key"]["Metric"],
                "resourcearn": instance_arn,
                "instance_id": instance_id,
                "num_vcpus": num_cpus
            }
            base_entry.update(metric["Key"]["Dimensions"])

            for datapoint in metric["DataPoints"]:
                flattened_entry = base_entry.copy()
                flattened_entry.update({
                    "timestamp": datapoint["Timestamp"].strftime("%Y-%m-%d %H:%M:%S%z"),
                    "value": datapoint["Value"]
                })

                all_flattened_metrics.append(flattened_entry)

    print(f"Total metrics processed for instance {instance_id}: {len(all_flattened_metrics)}")
    return all_flattened_metrics


def write_metrics_to_s3(s3_client, region_metrics):
    account_id = boto3.client('sts').get_caller_identity()['Account']

    # Group metrics by their individual timestamps
    for region, metrics in region_metrics.items():
        if not metrics:
            print(f"No metrics to process for region {region}")
            continue

        # Group metrics by their unique timestamp keys
        timestamp_grouped_metrics = {}
        for metric in metrics:
            timestamp = datetime.strptime(metric['timestamp'], "%Y-%m-%d %H:%M:%S%z")
            year = timestamp.strftime('%Y')
            month = timestamp.strftime('%m')
            day = timestamp.strftime('%d')
            hour = timestamp.strftime('%H')

            # Create a unique key for each timestamp
            timestamp_key = f"{year}/{month}/{day}/{hour}"
            
            if timestamp_key not in timestamp_grouped_metrics:
                timestamp_grouped_metrics[timestamp_key] = []
            
            timestamp_grouped_metrics[timestamp_key].append(metric)

        # Write metrics for each unique timestamp
        for timestamp_key, grouped_metrics in timestamp_grouped_metrics.items():
            year, month, day, hour = timestamp_key.split('/')

            # Create S3 key for this specific timestamp group
            s3_key = f"{metrics_s3_prefix}/account_id={account_id}/region={region}/year={year}/month={month}/day={day}/hour={hour}/metrics.parquet"

            print(f"Writing metrics to S3 key: {s3_key}")
            print(f"Total number of metrics: {len(grouped_metrics)}")

            # Convert to Arrow table
            table = pa.Table.from_pylist(grouped_metrics)

            # Write to Parquet format
            buf = BytesIO()
            pq.write_table(table, buf)
            buf.seek(0)

            # Upload to S3
            s3_client.put_object(
                Bucket=os.environ['METRICS_BUCKET'],
                Key=s3_key,
                Body=buf.getvalue()
            )
            print(f"Successfully wrote metrics to {s3_key}")
