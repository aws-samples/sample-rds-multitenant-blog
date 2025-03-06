import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';



export class MultitenancyPerformanceInsightsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //get from cdk parameter
    const glueDatabaseName = this.node.tryGetContext('glueDatabaseName') || 'rds-performance-insights-db' // default name if parameter is not specified
    // Use a static S3 bucket name
    const s3BucketName = `rds-metrics-${this.account}-${this.region}`;

    // s3 bucket for store metrics
    const bucket = new cdk.aws_s3.Bucket(this, 'RdsMetricsBucket', {
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      bucketName: s3BucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      serverAccessLogsPrefix: 'access_logs/',
      enforceSSL: true
    });

    // add lifecycle policy to s3 bucket to expire objects after 5 years
    bucket.addLifecycleRule({
      expiration: cdk.Duration.days(1825),
      prefix: '*'
    });

    // Create Lambda IAM role
    const lambdaRole = new cdk.aws_iam.Role(this, 'RDSMetricsLambdaRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    // Add specific policy statements
    // Allow Lambda to list and describe RDS instances across all regions
    lambdaRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: ['rds:DescribeDBInstances'],
      resources: ['*']
    }));

    // Allow Lambda to retrieve Performance Insights metrics from RDS instances
    lambdaRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: ['pi:GetResourceMetrics'],
      resources: ['*']
    }));

    // Allow Lambda to describe EC2 regions for cross-region operations
    lambdaRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['ec2:DescribeRegions'],
        resources: ['*']
      })
    );


    // Allow Lambda to create and write logs to CloudWatch
    lambdaRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
      resources: ['arn:aws:logs:*:*:*']
    }));

    // Allow Lambda to write objects to the metrics S3 bucket
    lambdaRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [`${bucket.bucketArn}/*`]
    }));

    // Create Lambda function to retrieve Performance Insights metrics hourly
    const retrievePerfInsightFnHourly = new cdk.aws_lambda.Function(this, 'RDSPerformanceInsightsFnHourly', {
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_13,
      handler: 'handler.lambda_handler',
      code: cdk.aws_lambda.Code.fromAsset('lib/src'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        'METRICS_BUCKET': bucket.bucketName,
        'METRICS_PERIOD_IN_SECONDS': '3600',
        'METRICS_S3_PREFIX': 'rds_pi_data_hourly'
      },
      role: lambdaRole,
    });

    // Create EventBridge rule to trigger Lambda function every hour
    const eventRuleHourly = new cdk.aws_events.Rule(this, 'EventRuleHourly', {
      schedule: cdk.aws_events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new cdk.aws_events_targets.LambdaFunction(retrievePerfInsightFnHourly)],
    });

    // Create Glue Database to store Performance Insights data
    const glueDatabase = new cdk.aws_glue.CfnDatabase(this, 'GlueDatabase', {
      catalogId: cdk.Aws.ACCOUNT_ID,
      databaseInput: {
        name: glueDatabaseName,
      },
    });

    // Create IAM role for Glue with required permissions
    const glueRole = new cdk.aws_iam.Role(this, 'GlueRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
      inlinePolicies: {
        'S3AccessPolicy': new cdk.aws_iam.PolicyDocument({
          statements: [
            new cdk.aws_iam.PolicyStatement({
              actions: ['s3:GetObject', 's3:PutObject'],
              resources: [`arn:aws:s3:::${bucket.bucketName}/*`],
            }),
          ],
        }),
      },
    });

    // Create Glue Data Catalog resources 
    this.dataCatalogResources(glueDatabase.catalogId, glueDatabaseName, 'rds_pi_data', glueRole.roleName, bucket.bucketName)
    this.dataCatalogResources(glueDatabase.catalogId, glueDatabaseName, 'rds_pi_data_hourly', glueRole.roleName, bucket.bucketName)
  }
  private dataCatalogResources(catalogId: string, glueDatabaseName: string, tableName: string, roleName: string, bucketName: string) {
    const rdsPiDataTable = new cdk.aws_glue.CfnTable(this, tableName === 'rds_pi_data' ? 'RDSPIDataTable' : ('RDSPIDataTable_' + tableName), {
      catalogId: catalogId,
      databaseName: glueDatabaseName,
      tableInput: {
        partitionKeys: [
          {
            name: 'account_id',
            type: 'string',
          },
          {
            name: 'year',
            type: 'string',
          },
          {
            name: 'month',
            type: 'string',
          },
          {
            name: 'day',
            type: 'string',
          },
          {
            name: 'hour',
            type: 'string',
          },
        ],
        name: tableName,
        storageDescriptor: {
          columns: [
            {
              name: 'metric',
              type: 'string',
            },
            {
              name: 'resourcearn',
              type: 'string',
            },
            {
              name: 'instance_id',
              type: 'string',
            },
            {
              name: 'num_vcpus',
              type: 'double',
            },
            {
              name: 'db.user.name',
              type: 'string',
            },
            {
              name: 'timestamp',
              type: 'string',
            },
            {
              name: 'value',
              type: 'double',
            }
          ],
          location: `s3://${bucketName}/${tableName}/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
        },
      },
    });

    // aws glue crawler
    const crawler = new cdk.aws_glue.CfnCrawler(this, 'Crawler_' + tableName, {
      name: 'PerformanceInsightsRDSCrawler_' + tableName,
      databaseName: glueDatabaseName,
      role: roleName,
      targets: {
        s3Targets: [
          {
            path: `s3://${bucketName}/${tableName}/`,
          },
        ],
      },
      schedule: {
        scheduleExpression: 'cron(50 */12 * * ? *)',
      },
      schemaChangePolicy: {
        updateBehavior: 'UPDATE_IN_DATABASE',
        deleteBehavior: 'LOG',
      },
    });
  }
}
