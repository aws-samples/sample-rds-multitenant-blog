import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ATHENA_VIEW_PI_DATA, ATHENA_VIEW_UNUSED_COST, ATHENA_VIEW_COST_ALLOCATION } from './athena-views';

/**
 * Utility function to validate required parameters
 * Throws an error if the parameter is undefined or empty
 * 
 * @param parameter - The parameter to check
 * @param message - Error message to display if parameter is missing
 * @returns The validated parameter
 */
const checkParameter = (parameter: string | undefined, message: string) => {
  if (!parameter) {
    throw new Error(message);
  }
  return parameter;
}

/**
 * AthenaViewsStack creates custom Athena views for performance insights and cost analysis
 * 
 * This stack is responsible for:
 * 1. Creating Athena views to analyze RDS Performance Insights data
 * 2. Generating cost allocation views
 * 3. Identifying unused cost resources
 * 
 * The stack uses AWS Custom Resources to dynamically create Athena views during deployment
 */
export class AthenaViewsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Retrieve configuration parameters from CDK context
    // Allows flexible configuration through CDK context or falls back to default values
    const glueDatabaseName = this.node.tryGetContext('glueDatabaseName') || 'rds-performance-insights-db' // Default database name
    const glueCURDBName = checkParameter(this.node.tryGetContext('glueCURDBName'), "Missing glueCURDBName parameter") // Cost and Usage Report Database Name
    const glueCURDBTable = checkParameter(this.node.tryGetContext('glueCURDBTable'), "Missing glueCURDBTable parameter") // Cost and Usage Report Table Name
    const s3BucketName = `rds-metrics-${this.account}-${this.region}`;

    // Create three distinct Athena views with specific purposes
    // Each view is created as a custom resource to ensure creation during stack deployment
    const athenaPIDataView = this.getAthenaViewCustomResource(
      'athenaPIDataView', 
      glueDatabaseName, 
      s3BucketName, 
      ATHENA_VIEW_PI_DATA(glueDatabaseName) // View for Performance Insights data
    );
    
    const athenaCostAllocationView = this.getAthenaViewCustomResource(
      'athenaCostAllocationView', 
      glueDatabaseName, 
      s3BucketName, 
      ATHENA_VIEW_COST_ALLOCATION(glueDatabaseName, glueCURDBName, glueCURDBTable) // View for cost allocation
    );
    
    const athenaUnusedCostView = this.getAthenaViewCustomResource(
      'athenaUnusedCostView', 
      glueDatabaseName, 
      s3BucketName, 
      ATHENA_VIEW_UNUSED_COST(glueDatabaseName) // View for identifying unused resources
    );
    
    // Establish dependencies between views to ensure correct creation order
    // Cost Allocation View depends on Performance Insights Data View
    athenaCostAllocationView.node.addDependency(athenaPIDataView)
    
    // Unused Cost View depends on Cost Allocation View
    athenaUnusedCostView.node.addDependency(athenaCostAllocationView)
  }

  /**
   * Creates an AWS Custom Resource to execute Athena view creation queries
   * 
   * @param name - Unique identifier for the custom resource
   * @param glueDatabaseName - Name of the Glue database
   * @param s3BucketName - S3 bucket for storing query results
   * @param viewDefinition - SQL query to create the Athena view
   * @returns An AWS Custom Resource for creating the Athena view
   */
  private getAthenaViewCustomResource(name: string, glueDatabaseName: string, s3BucketName: string, viewDefinition: string) {
    return new cdk.custom_resources.AwsCustomResource(this, name, {
      // Limit log retention to reduce storage costs
      logRetention: cdk.aws_logs.RetentionDays.ONE_DAY,
      
      // Provide time for view creation
      timeout: cdk.Duration.minutes(5),
      
      onUpdate: {
        service: 'Athena',
        action: 'startQueryExecution',
        parameters: {
          // Specify the database context for the view
          QueryExecutionContext: {
            'Database': glueDatabaseName
          },
          // The actual SQL view definition
          QueryString: viewDefinition,
          // Configure S3 location for query results
          ResultConfiguration: {
            OutputLocation: `s3://${s3BucketName}/athena_output/`,
          },
        },
        // Ensure a unique physical resource ID for each deployment
        physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(Date.now().toString())
      },
      
      // IAM policy to grant necessary permissions for view creation
      policy: cdk.custom_resources.AwsCustomResourcePolicy.fromStatements([
        // Permissions for Athena query execution
        new cdk.aws_iam.PolicyStatement({
          actions: [
            'athena:StartQueryExecution',
            'athena:CreateNamedQuery',
            'athena:StartQueryExecution',
            'athena:GetQueryExecution',
            'athena:GetQueryResults'
          ],
          resources: ['arn:aws:athena:*:*:workgroup/*'],
        }),
        // Permissions to get S3 bucket location
        new cdk.aws_iam.PolicyStatement({
          actions: ['s3:GetBucketLocation'],
          resources: ['*'],
        }),
        // Glue permissions for metadata management
        new cdk.aws_iam.PolicyStatement({
          actions: [
            // Core Glue actions needed for Athena view creation and metadata access
            'glue:GetDatabase',
            'glue:GetDatabases',
            'glue:GetTable',
            'glue:GetTables',
            'glue:GetPartitions',
            'glue:BatchGetPartitions',
            
            // Actions needed for view creation and management
            'glue:CreateTable',
            'glue:UpdateTable',
            'glue:DeleteTable',
            
            // Catalog and database management actions
            'glue:CreateDatabase',
            'glue:UpdateDatabase',
            'glue:DeleteDatabase',
            
            // Metadata and catalog operations
            'glue:GetCatalogImportStatus',
            'glue:ImportCatalogToGlue'
          ],
          resources: [
            'arn:aws:glue:*:*:catalog',
            'arn:aws:glue:*:*:database/*',
            'arn:aws:glue:*:*:table/*/*'],
        }),
        // S3 read/write permissions for Athena query results
        new cdk.aws_iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [
            `arn:aws:s3:::${s3BucketName}`,
            `arn:aws:s3:::${s3BucketName}/athena_output/*`
          ]
        }),
      ]),
      
      // Install the latest AWS SDK 
      installLatestAwsSdk: true
    });
  }
}
