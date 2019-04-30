# ColorTeller - AppMesh, X-Ray + Fargate Demo using AWS CDK

colorteller, appmesh envoy Docker images are hosted on dockerhub for now.

## Quick start (in AWS Cloud9 or anywhere)

```
nvm install 8.14.0
nvm alias default v8.14.0
npm i -g aws-cdk
npm install
npm run build
cdk deploy
```


## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
