import cdk = require('@aws-cdk/cdk');
import ec2 = require('@aws-cdk/aws-ec2');
import ecs = require('@aws-cdk/aws-ecs');
import elbv2 = require('@aws-cdk/aws-elasticloadbalancingv2');
import logs = require('@aws-cdk/aws-logs');
import iam = require('@aws-cdk/aws-iam');
import appmesh = require('@aws-cdk/aws-appmesh');

export class FargateAppmeshCdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //Service Discovery private DNS NameSpace
    const privateDomainName = "colordemo.local"
    const meshName = "colormesh"

    // The code that defines your stack goes here
    const logGroup = new logs.LogGroup(this, "LogGroup", {
      // logGroupName: "/cdk/fargate",
      retentionDays: 30,
      retainLogGroup: false
    })

    const healthCheckDefault = {
      "port": 'traffic-port',
      "path": '/ping',
      "intervalSecs": 30,
      "timeoutSeconds": 5,
      "healthyThresholdCount": 5,
      "unhealthyThresholdCount": 2,
      "healthyHttpCodes": "200,301,302"
    }

    //new vpc
    const vpc = new ec2.VpcNetwork(this, 'CDK-Fargate-VPC', {
      cidr: '10.88.0.0/16',
      maxAZs: 3
    });

    //sg for colortellers tasks
    const colortellerSecurityGroup = new ec2.SecurityGroup(this, "colortellerSecurityGroup", {
      allowAllOutbound: true,
      groupName: 'colortellerSecurityGroup',
      vpc: vpc
    })
    colortellerSecurityGroup.connections.allowFromAnyIPv4(new ec2.TcpPort(9080))
    colortellerSecurityGroup.connections.allowFromAnyIPv4(new ec2.TcpPort(2701))
    colortellerSecurityGroup.connections.allowFromAnyIPv4(new ec2.TcpPort(9901))
    colortellerSecurityGroup.connections.allowFromAnyIPv4(new ec2.TcpPort(15000))
    colortellerSecurityGroup.connections.allowFromAnyIPv4(new ec2.TcpPort(15001))

    //create a new mesh before we deploy any services on Fargate
    const colormesh = new appmesh.CfnMesh(this, 'color-appmesh', {
      meshName: meshName
    })

    const vnListener = {
      portMapping: {
        port: 9080,
        protocol: 'http'
      },
      healthCheck: {
        healthyThreshold: 2,
        intervalMillis: 5000, // min
        path: '/ping',
        port: 9080,
        protocol: 'http',
        timeoutMillis: 2000,
        unhealthyThreshold: 2
      }
    }

    const virtualNodes = ["colorteller-white", "colorteller-black", "colorteller-blue", "colorteller-red"]
    for (var v = 0; v < virtualNodes.length; v++) {
      let virtualNodeHostName = (virtualNodes[v] == "colorteller-white") ? "colorteller." + privateDomainName : virtualNodes[v] + '.' + privateDomainName
      new appmesh.CfnVirtualNode(this, "vn" + virtualNodes[v], {
        meshName: meshName,
        virtualNodeName: virtualNodes[v] + '-vn',
        spec: {
          listeners: [vnListener],
          serviceDiscovery: {
            dns: {
              hostname: virtualNodeHostName
            }
          }
        }
      }).addDependsOn(colormesh)
    }

    //echo virtual node and virtual service
    const tcpechoVirtualNode = new appmesh.CfnVirtualNode(this, "vn-tcpecho", {
      meshName: meshName,
      virtualNodeName: "tcpecho-vn",
      spec: {
        listeners: [{
          portMapping: {
            port: 2701,
            protocol: 'tcp'
          },
          healthCheck: {
            protocol: 'tcp',
            healthyThreshold: 2,
            unhealthyThreshold: 2,
            timeoutMillis: 2000,
            intervalMillis: 5000
          }
        }],
        serviceDiscovery: {
          dns: {
            hostname: "tcpecho." + privateDomainName
          }
        }
      }
    })
    tcpechoVirtualNode.addDependsOn(colormesh)

    new appmesh.CfnVirtualService(this, "vs-tcpecho", {
      meshName: meshName,
      virtualServiceName: "tcpecho." + privateDomainName,
      spec: {
        provider: {
          virtualNode: { virtualNodeName: 'tcpecho-vn' }
        }
      }
    }).addDependsOn(tcpechoVirtualNode)

    const colortellerVirtualRouter = new appmesh.CfnVirtualRouter(this, "vr-colorteller", {
      virtualRouterName: "colorteller-vr",
      meshName: meshName,
      spec: {
        listeners: [{
          portMapping: {
            port: 9080,
            protocol: 'http'
          }
        }]
      }
    })
    colortellerVirtualRouter.addDependsOn(colormesh)

    new appmesh.CfnRoute(this, 'route-colorteller', {
      meshName: meshName,
      virtualRouterName: "colorteller-vr",
      routeName: "colorteller-route",
      spec: {
        httpRoute: {
          action: {
            weightedTargets: [{
              virtualNode: "colorteller-blue-vn",
              weight: 1
            }
            // {
            //   virtualNode: "colorteller-red-vn",
            //   weight: 0
            // }
            // {
            //   virtualNode: "colorteller-white-vn",
            //   weight: 0
            // }
          ],
          },
          match: {
            prefix: '/'
          }
        }
      }
    }).addDependsOn(colortellerVirtualRouter)

    new appmesh.CfnVirtualService(this, 'vs-colorteller', {
      meshName: meshName,
      virtualServiceName: 'colorteller.' + privateDomainName,
      spec: {
        provider: {
          virtualRouter: { virtualRouterName: "colorteller-vr" }
        }
      }
    }).addDependsOn(colortellerVirtualRouter)


    new appmesh.CfnVirtualNode(this, "vn-colorgateway", {
      meshName: meshName,
      virtualNodeName: "colorgateway-vn",
      spec: {
        listeners: [{
          portMapping: {
            port: 9080,
            protocol: 'http'
          }
        }],
        serviceDiscovery: {
          dns: {
            hostname: "colorgateway." + privateDomainName
          }
        },
        backends: [{
          virtualService: {
            virtualServiceName: "colorteller." + privateDomainName
          }
        },
        {
          virtualService: {
            virtualServiceName: "tcpecho." + privateDomainName
          }
        }
        ]
      }
    }).addDependsOn(colormesh)


    // Fargate Cluster
    const fgCluster = new ecs.Cluster(this, 'fgappMeshCluster', {
      vpc: vpc
    })

    //add private domain to Fargate cluster
    fgCluster.addDefaultCloudMapNamespace({
      name: privateDomainName
    })

    
    // task iam role
    const taskIAMRole = new iam.Role(this, 'fgAppMeshDemoTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      inlinePolicies: {
        'XrayPut':
          new iam.PolicyDocument().addStatement(
            new iam.PolicyStatement()
              .allow()
              .addResource('*')
              .addAction('xray:PutTraceSegments')
          )
      }
    })

    //color gateway task definition
    const colorgatewayTaskDefinition = new ecs.FargateTaskDefinition(this, 'colorgateway-task-definition', {
      cpu: `256`,
      memoryMiB: `512`,
      taskRole: taskIAMRole
    });

    const colorgatwayContainer = colorgatewayTaskDefinition.addContainer('colorgateway', {
      image: ecs.ContainerImage.fromRegistry('kopi/colorgateway:latest'),
      environment: {
        'COLOR_TELLER_ENDPOINT': 'colorteller.' + privateDomainName + ':9080',
        'SERVER_PORT': '9080',
        'TCP_ECHO_ENDPOINT': 'tcpecho.' + privateDomainName + ':2701'
      },
      logging: new ecs.AwsLogDriver(this, 'fglog', {
        logGroup: logGroup,
        streamPrefix: "colorgateway-"
      })
    })
    colorgatwayContainer.addPortMappings({
      containerPort: 9080
    })

    const envoyContainer = colorgatewayTaskDefinition.addContainer('envoy', {
      image: ecs.ContainerImage.fromRegistry('kopi/appmesh:latest'),
      environment: {
        'APPMESH_VIRTUAL_NODE_NAME': 'mesh/' + meshName + '/virtualNode/colorgateway-vn',
        // APPMESH_XDS_ENDPOINT
        'ENABLE_ENVOY_STATS_TAGS': '1',
        'ENABLE_ENVOY_XRAY_TRACING': '1',
        'ENVOY_LOG_LEVEL': 'debug'
      },
      healthCheck: {
        command: ["curl -s http://localhost:9901/server_info | grep state | grep -q LIVE"],
        intervalSeconds: 5,
        timeout: 2,
        retries: 3
      },
      user: '1337',
      logging: new ecs.AwsLogDriver(this, 'colorgateway-envoylog', {
        logGroup: logGroup,
        streamPrefix: "colorgatewayenvoy-"
      })
    })
    envoyContainer.addPortMappings(
      { containerPort: 9901 },
      { containerPort: 15000 },
      { containerPort: 15001 }
    )
    envoyContainer.addUlimits({
      hardLimit: 15000,
      softLimit: 15000,
      name: ecs.UlimitName.Nofile
    })

    colorgatewayTaskDefinition.addContainer('xray', {
      image: ecs.ContainerImage.fromRegistry('amazon/aws-xray-daemon'),
      user: '1337',
      logging: new ecs.AwsLogDriver(this, 'colorgateway-xraylog', {
        logGroup: logGroup,
        streamPrefix: "colorgatewayxray-"
      })
    }).addPortMappings({
      containerPort: 2000,
      protocol: ecs.Protocol.Udp
    })

    const x = colorgatewayTaskDefinition.node.findChild('Resource') as ecs.CfnTaskDefinition;
    x.addPropertyOverride('ProxyConfiguration', {
      Type: 'APPMESH',
      ContainerName: 'envoy',
      ProxyConfigurationProperties: [
        {
          Name: 'IgnoredUID',
          Value: '1337',
        },
        {
          Name: 'ProxyIngressPort',
          Value: '15000',
        },
        {
          Name: 'ProxyEgressPort',
          Value: '15001',
        },
        {
          Name: 'AppPorts',
          Value: '9080'
        },
        {
          Name: 'EgressIgnoredIPs',
          Value: '169.254.170.2,169.254.169.254',
        },
      ],
    });

    const colorgatewayService = new ecs.FargateService(this, 'colorgateway-service', {
      cluster: fgCluster,
      desiredCount: 1,
      taskDefinition: colorgatewayTaskDefinition,
      serviceDiscoveryOptions: {
        name: 'colorgateway',
        dnsTtlSec: 300
      }
    });

    const externalLB = new elbv2.ApplicationLoadBalancer(this, 'external', {
      vpc: vpc,
      internetFacing: true
    });
    const externalListener = externalLB.addListener('PublicListener', {
      port: 80
    });

    externalListener.addTargets('colorgateway', {
      port: 80,
      // pathPattern: "/color*",
      // priority: 4,
      healthCheck: healthCheckDefault,
      targets: [colorgatewayService]
    });


    //vue app
    const vueAppDefinition = new ecs.FargateTaskDefinition(this, 'vapp',{
      cpu: '2048',
      memoryMiB: '4096'
    });
    vueAppDefinition.addContainer('vueApp', {
      // image: ecs.ContainerImage.fromRegistry('kopi/vuecolorteller:latest'),
      image: ecs.ContainerImage.fromAsset(this, 'vueapp-image', {
        directory: './vueapp'
      }),
      cpu: 1024,
      memoryLimitMiB: 2048,
      logging: new ecs.AwsLogDriver(this, 'vueappcolorteller-logs', {
        streamPrefix: 'vueApp'
      })
    }).addPortMappings({
      containerPort: 80
    })

    let vueAppService = new ecs.FargateService(this, 'vueappcolorteller', {
      cluster: fgCluster,
      desiredCount: 1,
      taskDefinition: vueAppDefinition
    });

    externalListener.addTargets('vue', {
      port: 80,
      pathPattern: "/app*",
      priority: 100,
      healthCheck: {
        "port": 'traffic-port',
        "path": '/',
        "intervalSecs": 30,
        "timeoutSeconds": 5,
        "healthyThresholdCount": 5,
        "unhealthyThresholdCount": 2,
        "healthyHttpCodes": "200,301,302"
      },
      targets: [vueAppService]
    })


    // tcp echo task and service
    const echoTaskDefinition = new ecs.FargateTaskDefinition(this, 'echo-task-definition', {
      taskRole: taskIAMRole
    })
    echoTaskDefinition.addContainer('echo', {
      image: ecs.ContainerImage.fromRegistry('cjimti/go-echo'),
      environment: {
        'NODE_NAME': 'mesh/' + meshName + '/virtualNode/tcpecho-vn',
        'TCP_PORT': '2701'
      }
    }).addPortMappings({
      containerPort: 2701
    })
    new ecs.FargateService(this, "echo-service", {
      cluster: fgCluster,
      desiredCount: 1,
      taskDefinition: echoTaskDefinition,
      securityGroup: colortellerSecurityGroup,
      serviceDiscoveryOptions: {
        name: 'tcpecho',
        dnsTtlSec: 300
      }
    })

    // Colors Services
    const colorTellers = ["white", "black", "red", "blue",]
    let colorTellersTaskDefinition = new Array()

    for (var v = 0; v < colorTellers.length; v++) {
      colorTellersTaskDefinition[v] = new ecs.FargateTaskDefinition(this, 'colorteller-' + colorTellers[v] + '-task-definition', {
        taskRole: taskIAMRole
      })
      colorTellersTaskDefinition[v].addContainer('colortellerApp', {
        image: ecs.ContainerImage.fromRegistry('kopi/colorteller'),
        environment: {
          'COLOR': colorTellers[v],
          'SERVER_PORT': '9080'
        },
        logging: new ecs.AwsLogDriver(this, 'colortellerApp-' + colorTellers[v] + '-log', {
          logGroup: logGroup,
          streamPrefix: 'colorteller-' + colorTellers[v] + '-'
        }),
      }).addPortMappings({
        containerPort: 9080
      })

      let thisEnvoy = colorTellersTaskDefinition[v].addContainer('envoy', {
        image: ecs.ContainerImage.fromRegistry('kopi/appmesh:latest'),
        environment: {
          'APPMESH_VIRTUAL_NODE_NAME': 'mesh/' + meshName + '/virtualNode/colorteller-' + colorTellers[v] + '-vn',
          'ENABLE_ENVOY_STATS_TAGS': '1',
          'ENABLE_ENVOY_XRAY_TRACING': '1',
          'ENVOY_LOG_LEVEL': 'debug'
        },
        healthCheck: {
          command: ["curl -s http://localhost:9901/server_info | grep state | grep -q LIVE"],
          intervalSeconds: 5,
          timeout: 2,
          retries: 3
        },
        user: '1337',
        logging: new ecs.AwsLogDriver(this, 'envoy-colorteller-' + colorTellers[v] + 'Log', {
          logGroup: logGroup,
          streamPrefix: "envoy-colorteller-" + colorTellers[v]
        })
      })
      thisEnvoy.addPortMappings(
        { containerPort: 9901 },
        { containerPort: 15000 },
        { containerPort: 15001 }
      )
      thisEnvoy.addUlimits({
        hardLimit: 15000,
        softLimit: 15000,
        name: ecs.UlimitName.Nofile
      })

      colorTellersTaskDefinition[v].addContainer('xray', {
        image: ecs.ContainerImage.fromRegistry('amazon/aws-xray-daemon'),
        user: '1337',
        logging: new ecs.AwsLogDriver(this, 'colorteller-' + colorTellers[v] + '-xraylog', {
          logGroup: logGroup,
          streamPrefix: 'xray-colorteller-' + colorTellers[v]
        })
      }).addPortMappings({
        containerPort: 2000,
        protocol: ecs.Protocol.Udp
      })

      let proxyCfg = colorTellersTaskDefinition[v].node.findChild('Resource') as ecs.CfnTaskDefinition;
      proxyCfg.addPropertyOverride('ProxyConfiguration', {
        Type: 'APPMESH',
        ContainerName: 'envoy',
        ProxyConfigurationProperties: [
          {
            Name: 'IgnoredUID',
            Value: '1337',
          },
          {
            Name: 'ProxyIngressPort',
            Value: '15000',
          },
          {
            Name: 'ProxyEgressPort',
            Value: '15001',
          },
          {
            Name: 'AppPorts',
            Value: '9080'
          },
          {
            Name: 'EgressIgnoredIPs',
            Value: '169.254.170.2,169.254.169.254',
          },
        ],
      });


      let fgServiceName = (colorTellers[v] == "white") ? "colorteller" : "colorteller-" + colorTellers[v]
      new ecs.FargateService(this, 'colorteller-' + colorTellers[v] + '-service', {
        cluster: fgCluster,
        desiredCount: 1,
        taskDefinition: colorTellersTaskDefinition[v],
        securityGroup: colortellerSecurityGroup,
        serviceDiscoveryOptions: {
          name: fgServiceName,
          dnsTtlSec: 360
        }
      })

    }

    //print out ALB DNS
    new cdk.CfnOutput(this, 'ALBDNS: ', { value: externalLB.dnsName });
  }
}