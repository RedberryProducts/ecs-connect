#! /usr/bin/env node

import chalk, { Chalk } from 'chalk';
import inquirer from 'inquirer';
import {
    ECSClient, 
    ListTasksCommand, 
    ListClustersCommand, 
    ListServicesCommand,
    DescribeTasksCommand,
    DescribeServicesCommand, 
    DescribeClustersCommand,
} from '@aws-sdk/client-ecs';
import { spawn, execSync } from 'child_process';
import { createSpinner } from 'nanospinner'

const data = {
    cluster: {
        name: null,
        arn: null,
    },
    service: {
        name: null,
        arn: null,
    },
    taskArn: null,
    containers: null,
    containerRuntimeId: null,
    version: '0.3.7-beta',
};

const client = new ECSClient();

const getCurrentVersion = () => {
    return data.version;
}

const getLatestVersion = () => {
    return execSync('npm view ecs-connect version').toString().trim();
}

const isUpToDate = () => {
    return getCurrentVersion() === getLatestVersion();
}

const checkVersion = () => {
    if(! isUpToDate())
    {
        console.log('Your version is behind! - ' + chalk.redBright.italic(getCurrentVersion()))
        console.log(
            'Please update the package to get the latest version! ' + 
            chalk.yellow.italic(latestVersion()),
        );
        console.log('Run ' + chalk.yellowBright.italic('npm update -g ecs-connect'));
        console.log("\n\n");
    }
}

const welcome = () => {
    console.log(
        chalk.bold.blueBright('ECS Connect 🔌'),
    );
    console.log('');
}


const askAboutCluster = async () => {
    const { clusterArns } = await client.send(new ListClustersCommand({}));
    const { clusters } = await client.send(
        new DescribeClustersCommand({ clusters: clusterArns }),
    );

    const answer = await inquirer.prompt([{
        type: 'list',
        name: 'cluster',
        message: 'Choose your cluster',
        choices: clusters.map(el => el.clusterName),
    }]);

    data.cluster.name = answer.cluster;
    data.cluster.arn = clusters.find(el => el.clusterName === answer.cluster).clusterArn; 
}

const askAboutServices = async () => {
    const { serviceArns } = await client.send(new ListServicesCommand({ cluster: data.cluster.arn }));
    const { services } = await client.send(new DescribeServicesCommand({ services: serviceArns, cluster: data.cluster.arn }));
    
    const { service } = await inquirer.prompt([{
        type: 'list',
        name: 'service',
        message: 'Choose service inside a cluster',
        choices: services.map(el => el.serviceName),
    }]);

    data.service.name = service;
    data.service.arn = services.find(el => el.serviceName === service).serviceArn;
}

const askAboutTasks = async () => {
    const { taskArns } = await client.send(new ListTasksCommand({cluster: data.cluster.arn, serviceName: data.service.name, desiredStatus: 'RUNNING'}));
    const { tasks } = await client.send(new DescribeTasksCommand({cluster: data.cluster.arn, tasks: taskArns }));
    const taskTrimmedArns = tasks.map(el => {
        const chunks = el.taskArn.split(data.cluster.name + '/');
        return chunks[chunks.length - 1];
    });

    const { task } = await inquirer.prompt([{
        type: 'list',
        name: 'task',
        message: 'Choose task inside service',
        choices: taskTrimmedArns,
    }]);

    data.taskArn = task;
    data.containers = tasks.find(el => el.taskArn.endsWith(task)).containers;
}

const askAboutContainers = async () => {
    const { container } = await inquirer.prompt([{
        type: 'list',
        name: 'container',
        message: 'Choose container to connect',
        choices: data.containers.map(el => el.name),
    }]);

    data.containerRuntimeId = data.containers.find(el => el.name === container).runtimeId;
}

const connectToContainer = () => {
    const target = `ecs:${data.cluster.name}_${data.taskArn}_${data.containerRuntimeId}`;
    const command = `aws ssm start-session --target ${target}`;
    console.log("\n");

    const spinner = createSpinner('Wait for connection...');
    spinner.start();
    setTimeout(() => {
        spinner.stop();
        spawn(command, {stdio: 'inherit', shell: 'sh'});
    }, 3000);
}


(async function () {
    checkVersion();
    welcome();
    await askAboutCluster();
    await askAboutServices();
    await askAboutTasks();
    await askAboutContainers();
    connectToContainer();
})();