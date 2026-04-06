#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VanishDropStack } from '../lib/vanishdrop-stack';

const app = new cdk.App();

new VanishDropStack(app, 'VanishDropStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
