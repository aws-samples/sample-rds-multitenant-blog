# AWS DBS Blogs - Improve cost visibility of Amazon RDS Multi-Tenant Instance with Performance Insights and Amazon Athena

This repository contains the AWS CDK code and resources associated with the blog post "Improving Cost Visibility of Amazon RDS Multi-Tenant Instance with Performance Insights and Amazon Athena".

You can find the blogpost here: https://aws-blogs-prod.amazon.com/database/improve-cost-visibility-of-an-amazon-rds-multi-tenant-instance-with-performance-insights-and-amazon-athena

## Overview

In this project, we demonstrate how to leverage Amazon RDS Performance Insights and Amazon Athena to gain better cost visibility for multi-tenant databases hosted on Amazon RDS. This solution helps organizations accurately allocate costs to different tenants and optimize database performance.

The CDK stack in this repository deploys the following resources:

- Amazon S3 bucket for storing Performance Insights data
- Amazon Athena Table and Views
- AWS Glue crawlers and database
- IAM roles and policies

## Prerequisites

Before you begin, ensure you have the following:

- An AWS account
- [CUR 2.0](https://docs.aws.amazon.com/cur/latest/userguide/data-exports-migrate-two.html) enabled and mapped to a Glue table in the same account
- AWS CDK installed and configured
- Node.js and npm installed
- Basic knowledge of AWS services, particularly RDS, Athena, and Glue

## Setup Project

1. Clone the repository
2. `npm install`
3. `cdk bootstrap` your AWS region

## Deploy Stacks

The deployment script supports both deployment and destruction of stacks with the following syntax:

```bash
./deployment.sh <mode> <glueCURDBName> <glueCURDBTable> <region>
```

### Parameters

- `mode`: Either `deploy` or `destroy`
- `glueCURDBName`: Name of the Glue Cost and Usage Report (CUR 2.0) database
- `glueCURDBTable`: Name of the Glue CUR 2.0 table
- `region`: AWS region for deployment

### Deployment Example

```bash
./deployment.sh deploy athenacurcfn_cur_export cur_export_legacy eu-west-1
```

### Destruction Example

```bash
./deployment.sh destroy athenacurcfn_cur_export cur_export_legacy eu-west-1
```

## Deployment Details

The script performs the following actions:

1. Validates input parameters
2. Deploys two CDK stacks:
   - RdsMultitenantPIStack (Performance Insights Stack)
   - RdsMultitenantAthenaViewsStack (Athena Views Stack)
3. Uses CDK context variables to configure stack deployment
4. Provides error handling for deployment failures

## Usage

After deployment, you can use the Athena views to analyze your RDS Performance Insights data and gain insights into tenant-specific resource usage and costs.

## Blog Post

For a detailed walkthrough and explanation of the solution, please refer to the accompanying blog post: [Link to be added when published]

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for more details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
