import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '../utils/logger';

export interface AppConfig {
  domain: 'xiaohongshu.com' | 'rednote.com';
}

const DEFAULT_CONFIG: AppConfig = {
  domain: 'xiaohongshu.com',
};

function getConfigDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.mcp', 'rednote');
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export class ConfigManager {
  static async load(): Promise<AppConfig> {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
      logger.info('No config file found, using default (xiaohongshu.com)');
      return { ...DEFAULT_CONFIG };
    }
    try {
      const data = await fs.promises.readFile(configPath, 'utf-8');
      const config = JSON.parse(data);
      logger.info(`Loaded config: domain=${config.domain}`);
      return config as AppConfig;
    } catch (error) {
      logger.error('Error loading config, using default:', error);
      return { ...DEFAULT_CONFIG };
    }
  }

  static async save(config: AppConfig): Promise<void> {
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const configPath = getConfigPath();
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
    logger.info(`Saved config: domain=${config.domain}`);
  }

  /**
   * Detect the domain from a hostname string.
   * Returns 'rednote.com' if the hostname contains 'rednote',
   * otherwise defaults to 'xiaohongshu.com'.
   */
  static detectDomain(hostname: string): AppConfig['domain'] {
    if (hostname.includes('rednote')) {
      return 'rednote.com';
    }
    return 'xiaohongshu.com';
  }

  /**
   * Build the base URL from the configured domain.
   */
  static getBaseUrl(config: AppConfig): string {
    return `https://www.${config.domain}`;
  }
}
