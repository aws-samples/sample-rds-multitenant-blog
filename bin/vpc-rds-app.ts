#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MultitenancyFoundationStack } from '../lib/foundation-stack';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

const app = new cdk.App();
Aspects.of(app).add(new AwsSolutionsChecks());

const env = { region: 'eu-west-1' }
new MultitenancyFoundationStack(app, 'MultitenancyFoundationStack', {
    env
})

NagSuppressions.addResourceSuppressions(app, [
    {
        id: 'AwsSolutions-RDS10',
        reason: 'This is a example stack. RDS should be deleted when cf stack is destroyed'
    },
    {
        id: 'AwsSolutions-RDS11',
        reason: 'This is a example stack and default endpoint is used'
    }
], true)