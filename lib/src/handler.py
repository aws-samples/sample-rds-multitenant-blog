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
    
    # Collect instances from all regions
    all_instances = []
    
    # Create S3 and Performance Insights clients
    s3_client = boto3.client('s3')
    
    # Iterate through all regions
    for region in regions:
        try:
            # Create region-specific RDS and Performance Insights clients
            rds_client = boto3.client('rds', region_name=region)
            pi_client = boto3.client('pi', region_name=region)
            
            # Get RDS instances in this region
            rds_instances = get_rds_instances(rds_client)
            
            # Process each RDS instance
            for instance in rds_instances:
                instance_id = instance['DbiResourceId']
                instance_arn = instance['DBInstanceArn']
                print(f"Processing metrics for instance {instance_arn} in region {region}")

                # Check if Performance Insights is enabled
                if instance.get('PerformanceInsightsEnabled', False):
                    # Get Performance Insights metrics
                    metrics = get_performance_metrics(pi_client, instance_id)

                    # Process and store the metrics in S3
                    process_metrics(s3_client, instance_id, instance_arn, metrics, region)
                else:
                    print(f"Performance Insights not enabled for instance {instance_id} in {region}")
        
        except Exception as e:
            print(f"Error processing region {region}: {str(e)}")
    
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


def process_metrics(s3_client, instance_id, instance_arn, metrics, region):
    account_id = boto3.client('sts').get_caller_identity()['Account']
    
    flattened_metrics = defaultdict(list)
    num_cpus = ''

    for metric in metrics:
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

                year = datapoint["Timestamp"].strftime('%Y')
                month = datapoint["Timestamp"].strftime('%m')
                day = datapoint["Timestamp"].strftime('%d')
                hour = datapoint["Timestamp"].strftime('%H')

                s3_key = f"{metrics_s3_prefix}/account_id={account_id}/region={region}/year={year}/month={month}/day={day}/hour={hour}/metrics.parquet"

                flattened_metrics[s3_key].append(flattened_entry)

    if not flattened_metrics:
        print("No metrics to process, skipping write to S3")

    for s3_key, metrics in flattened_metrics.items():
        if metrics:
            # Convert to Arrow table
            table = pa.Table.from_pylist(metrics)

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
