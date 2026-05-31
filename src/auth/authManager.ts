import {Browser, BrowserContext, chromium, Cookie, Page} from 'playwright';
import {CookieManager} from './cookieManager';
import {ConfigManager} from './configManager';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '../utils/logger';

dotenv.config();

export class AuthManager {
  private browser: Browser | null;
  private context: BrowserContext | null;
  private page: Page | null;
  private cookieManager: CookieManager;

  constructor(cookiePath?: string) {
    logger.info('Initializing AuthManager');
    this.browser = null;
    this.context = null;
    this.page = null;

    // Set default cookie path to ~/.mcp/rednote/cookies.json
    if (!cookiePath) {
      const homeDir = os.homedir();
      const mcpDir = path.join(homeDir, '.mcp');
      const rednoteDir = path.join(mcpDir, 'rednote');

      // Create directories if they don't exist
      if (!fs.existsSync(mcpDir)) {
        logger.info(`Creating directory: ${mcpDir}`);
        fs.mkdirSync(mcpDir);
      }
      if (!fs.existsSync(rednoteDir)) {
        logger.info(`Creating directory: ${rednoteDir}`);
        fs.mkdirSync(rednoteDir);
      }

      cookiePath = path.join(rednoteDir, 'cookies.json');
    }

    logger.info(`Using cookie path: ${cookiePath}`);
    this.cookieManager = new CookieManager(cookiePath);
  }

  async getBrowser(): Promise<Browser> {
    logger.info('Launching browser');
    // 始终创建新的浏览器实例，不复用之前的
    this.browser = await chromium.launch({
      headless: false,
    });
    return this.browser;
  }

  async getCookies(): Promise<Cookie[]> {
    logger.info('Loading cookies');
    return await this.cookieManager.loadCookies();
  }

  async login(options?: {timeout?: number}): Promise<void> {
    const timeoutSeconds = options?.timeout || 120
    logger.info(`Starting login process with timeout: ${timeoutSeconds}s`)

    this.browser = await chromium.launch({ headless: false })
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    })
    this.page = await this.context.newPage()

    // Load existing cookies
    const cookies = await this.cookieManager.loadCookies()
    if (cookies.length > 0) {
      await this.context.addCookies(cookies)
    }

    // Navigate directly to rednote.com to avoid xiaohongshu.com → rednote.com redirect loop
    await this.page.goto('https://www.rednote.com/explore', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    // Let page fully render (login dialog may animate in)
    await this.page.waitForTimeout(5000)

    const currentUrl = this.page.url()
    logger.info(`Page settled at: ${currentUrl}`)

    // Check login status — use multiple indicators
    const checkLoggedIn = async (): Promise<boolean> => {
      if (!this.page) return false
      return await this.page.evaluate(() => {
        // Method 1: sidebar channel text
        const sidebar = document.querySelector('.user.side-bar-component .channel, [class*="side-bar"] [class*="channel"]')
        const sidebarText = (sidebar?.textContent || '').trim()
        if (sidebarText === '我' || sidebarText === 'Me' || sidebarText === 'Profile') return true

        // Method 2: user avatar/menu visible
        const avatar = document.querySelector('.side-bar-user img, .side-bar-user, [class*="user-avatar"] img, [class*="UserAvatar"]')
        if (avatar) return true

        // Method 3: no login modal/QR on page
        const hasLoginModal = !!document.querySelector('.login-container, .qrcode-img, [class*="qrcode"], [class*="qr-code"]')
        const url = window.location.href
        // If not on login page AND no login modal visible, likely logged in
        if (!url.includes('/login') && !hasLoginModal) {
          // Check for any interactive user element
          const userElements = document.querySelectorAll('[class*="user"], [class*="avatar"], [class*="profile"], [class*="message"], [class*="notification"], [class*="create"]')
          if (userElements.length > 3) return true
        }

        return false
      })
    }

    if (await checkLoggedIn()) {
      logger.info('Already logged in')
      const hostname = new URL(this.page!.url()).hostname
      await ConfigManager.save({ domain: ConfigManager.detectDomain(hostname) })
      await this.cookieManager.saveCookies(await this.context!.cookies())
      return
    }

    // Wait for user to scan QR code
    logger.info('Please scan the QR code in the browser window to log in...')

    const deadline = Date.now() + timeoutSeconds * 1000
    while (Date.now() < deadline) {
      if (!this.page) break
      await this.page.waitForTimeout(3000)
      if (await checkLoggedIn()) {
        logger.info('Login complete!')
        if (this.page) {
          const hostname = new URL(this.page.url()).hostname
          await ConfigManager.save({ domain: ConfigManager.detectDomain(hostname) })
        }
        if (this.context) {
          await this.cookieManager.saveCookies(await this.context.cookies())
        }
        return
      }
    }
    throw new Error(`Login timed out after ${timeoutSeconds}s`)
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up browser resources');
    if (this.page) await this.page.close();
    if (this.context) await this.context.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
