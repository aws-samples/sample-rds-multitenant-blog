import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class MultitenancyFoundationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const existingRdsId = this.node.tryGetContext('existingRdsId');
    const glueDatabaseName = 'performance-insights-db'

    // Database Vpc
    const vpc = new cdk.aws_ec2.Vpc(this, 'Vpc', {
      ipAddresses: cdk.aws_ec2.IpAddresses.cidr('10.0.0.0/16'),
      natGateways: 1,
      maxAzs: 3,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'private',
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'public',
          subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
        }
      ],
      flowLogs: {
        'VpcFlowLogs': {
          trafficType: cdk.aws_ec2.FlowLogTrafficType.ALL,
          destination: cdk.aws_ec2.FlowLogDestination.toCloudWatchLogs()
        }
      }
    });

    // database postgresql security group
    const rdsSg = new cdk.aws_ec2.SecurityGroup(this, 'RdsSg', { vpc: vpc });
    // add to the security group inbound traffic from the same security group
    rdsSg.addIngressRule(rdsSg, cdk.aws_ec2.Port.tcp(5432), 'allow inbound from the same security group');
    

    //rdsSg allow inbound from lambda sg
    let rds;
    if (existingRdsId) { // "import" rds instance if passed as cdk context variable
      rds = cdk.aws_rds.DatabaseInstance.fromDatabaseInstanceAttributes(this, 'Rds', {
        instanceIdentifier: existingRdsId,
        instanceEndpointAddress: existingRdsId + `.${props?.env?.region}.rds.amazonaws.com`,
        port: 5432,
        securityGroups: [cdk.aws_ec2.SecurityGroup.fromSecurityGroupId(this, 'RdsSg', vpc.vpcDefaultSecurityGroup)]
      });
    }
    else { // else create a new rds database single instance
      const credential = cdk.aws_rds.Credentials.fromGeneratedSecret('adminuser')
      rds = new cdk.aws_rds.DatabaseInstance(this, 'RdsDatabase', {
        engine: cdk.aws_rds.DatabaseInstanceEngine.postgres({
          version: cdk.aws_rds.PostgresEngineVersion.VER_16_4,
        }),
        instanceType: cdk.aws_ec2.InstanceType.of(
          cdk.aws_ec2.InstanceClass.T4G,
          cdk.aws_ec2.InstanceSize.MEDIUM,
        ),
        enablePerformanceInsights: true,
        vpc: vpc,
        vpcSubnets: {
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        storageEncrypted: true,
        multiAz: true,
        securityGroups: [rdsSg],
        maxAllocatedStorage: 200,
        databaseName: 'dev',
        credentials: credential,
        deletionProtection: false
      });

      // add automatic rotation to secret
      rds.addRotationSingleUser({
        automaticallyAfter: cdk.Duration.days(30),
        excludeCharacters: '!@#$%^&*()_+=-`~[]{}|;:,.<>/',
      });
    }



      /* new small ec2 instance that can access rds
      const ec2 = new cdk.aws_ec2.Instance(this, 'Ec2', {
        vpc: vpc,
        vpcSubnets: {
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        instanceType: cdk.aws_ec2.InstanceType.of(
          cdk.aws_ec2.InstanceClass.T4G,
          cdk.aws_ec2.InstanceSize.XLARGE,
        ),
        machineImage: cdk.aws_ec2.MachineImage.latestAmazonLinux2023(),
        securityGroup: rdsSg,
      });

      // add a userdata to the instance that allow to connect to rds and install pgsql client
      ec2.userData.addCommands(
        'dnf update -y',
        'dnf install postgresql15 -y',
        
      );*/


  }
}
