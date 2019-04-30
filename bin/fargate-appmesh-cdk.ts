#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/cdk');
import { FargateAppmeshCdkStack } from '../lib/fargate-appmesh-cdk-stack';

const app = new cdk.App();
new FargateAppmeshCdkStack(app, 'FargateAppmeshCdkStack');
