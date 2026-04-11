import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class VanishDropStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const githubRepo = this.node.tryGetContext('githubRepo') || '*';
    const serverAmiId =
      this.node.tryGetContext('serverAmiId') || 'ami-0ea87431b78a82070';

    // ── S3: file uploads bucket ───────────────────────────────────────────
    const uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      bucketName: `vanishdrop-uploads-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'AutoDeleteUploads',
          enabled: true,
          prefix: 'uploads/',
          expiration: cdk.Duration.days(1),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const testUploadsBucket = new s3.Bucket(this, 'TestUploadsBucket', {
      bucketName: `vanishdrop-test-uploads-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'AutoDeleteTestUploads',
          enabled: true,
          prefix: 'integration-tests/',
          expiration: cdk.Duration.days(3),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
        {
          id: 'AutoDeleteAppTestUploads',
          enabled: true,
          prefix: 'uploads/',
          expiration: cdk.Duration.days(3),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── S3: deployment artifacts bucket ───────────────────────────────────
    const deployBucket = new s3.Bucket(this, 'DeployBucket', {
      bucketName: `vanishdrop-deploy-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(7) }],
    });

    // ── IAM role for EC2 ──────────────────────────────────────────────────
    const ec2Role = new iam.Role(this, 'EC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        // SSM agent — receives deploy commands from GitHub Actions
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    uploadsBucket.grantReadWrite(ec2Role);
    uploadsBucket.grantDelete(ec2Role);
    deployBucket.grantRead(ec2Role);

    // ── EC2 networking ────────────────────────────────────────────────────
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true });

    const sg = new ec2.SecurityGroup(this, 'ServerSG', {
      vpc,
      description: 'VanishDrop server',
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');

    // ── EC2 instance ──────────────────────────────────────────────────────
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -',
      'dnf install -y nodejs',
      'npm install -g pm2',
      'env PATH=$PATH:/usr/bin pm2 startup systemd -u ec2-user --hp /home/ec2-user',
      'dnf install -y nginx',
      `cat > /etc/nginx/nginx.conf << 'EOF'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log /var/log/nginx/access.log;
    sendfile on;
    keepalive_timeout 65;
    include /etc/nginx/conf.d/*.conf;
}
EOF`,
      `cat > /etc/nginx/conf.d/vanishdrop.conf << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 110m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
    }
}
EOF`,
      'systemctl enable nginx',
      'systemctl start nginx'
    );

    const instance = new ec2.Instance(this, 'Server', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      // Pin the AMI so routine CDK deploys do not replace the instance when AWS
      // publishes a newer "latest" Amazon Linux image.
      machineImage: ec2.MachineImage.genericLinux({
        [this.region]: serverAmiId,
      }),
      securityGroup: sg,
      role: ec2Role,
      userData,
    });

    const eip = new ec2.CfnEIP(this, 'ServerEIP', {
      instanceId: instance.instanceId,
    });

    // ── GitHub Actions OIDC ───────────────────────────────────────────────
    const githubProvider = new iam.OpenIdConnectProvider(this, 'GithubOIDC', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const githubActionsRole = new iam.Role(this, 'GithubActionsRole', {
      roleName: 'VanishDrop-GitHubActions',
      assumedBy: new iam.WebIdentityPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringLike: {
            'token.actions.githubusercontent.com:sub': [
              `repo:${githubRepo}:ref:refs/heads/*`,
              `repo:${githubRepo}:pull_request`,
            ],
          },
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
        }
      ),
    });

    // GitHub Actions: upload zip to S3 + send deploy command to EC2 via SSM
    deployBucket.grantReadWrite(githubActionsRole);
    testUploadsBucket.grantReadWrite(githubActionsRole);
    testUploadsBucket.grantDelete(githubActionsRole);
    githubActionsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ssm:SendCommand',
          'ssm:GetCommandInvocation',
        ],
        resources: ['*'],
      })
    );

    // ── Outputs ───────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ServerIP', {
      value: eip.ref,
      description: 'Point your domain here, then add to Cloudflare',
    });

    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'GitHub secret: EC2_INSTANCE_ID',
    });

    new cdk.CfnOutput(this, 'UploadsBucketName', {
      value: uploadsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'TestUploadsBucketName', {
      value: testUploadsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'DeployBucketName', {
      value: deployBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
      value: githubActionsRole.roleArn,
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
    });
  }
}
