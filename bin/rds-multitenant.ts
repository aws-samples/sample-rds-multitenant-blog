#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { MultitenancyPerformanceInsightsStack } from '../lib/multitenancy-performance-insights-stack';
import { AthenaViewsStack } from '../lib/athena-views-stack';


const app = new cdk.App();
const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION;

Aspects.of(app).add(new AwsSolutionsChecks());

new MultitenancyPerformanceInsightsStack(app, 'RdsMultitenantPIStack', {
  env: { region }
});

new AthenaViewsStack(app, 'RdsMultitenantAthenaViewsStack', {
  env: { region }
});

NagSuppressions.addResourceSuppressions(app, [
  {
    id: 'AwsSolutions-IAM4',
    reason: 'The only managed policy is "AWSGlueServiceRole" used for Glue crawler as stated in the pre-requisites https://docs.aws.amazon.com/glue/latest/dg/crawler-prereqs.html'
  },
  {
    id: 'AwsSolutions-IAM5',
    reason: 'The wildcards are used only to \
    1. allow the Lambda to list all RDS instances in the account\
    2. allow the Lambda to retrieve the Performance Insights metrics for all RDS instances in the account\
    3. allow the lambda to read and write from and to the metrics bucket only\
    4. allow the crawler to access all the objects in the performance insights bucket'
  },
  {
    id: 'AwsSolutions-L1',
    reason: 'The only lambda that does not use the most recent runtime is the one managed by cdk to create the custom resource to deploy athena views'
  }
], true)