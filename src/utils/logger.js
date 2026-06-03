import chalk from 'chalk';

const level = process.env.LOG_LEVEL ?? 'info';
const levels = { debug: 0, info: 1, error: 2 };

export const log = {
  debug: (msg) => levels[level] <= 0 && console.log(chalk.gray(`[debug] ${msg}`)),
  info:  (msg) => levels[level] <= 1 && console.log(chalk.blue(`[info]  ${msg}`)),
  error: (msg) => levels[level] <= 2 && console.error(chalk.red(`[error] ${msg}`)),
  success: (msg) => console.log(chalk.green(`[✓]     ${msg}`)),
};
