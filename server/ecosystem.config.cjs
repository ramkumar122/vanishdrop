module.exports = {
  apps: [
    {
      name: 'vanishdrop',
      script: 'src/index.js',
      cwd: '/home/ec2-user/vanishdrop/server',
      exec_mode: 'fork',
      instances: 1,
    },
  ],
};
