import { AuthManager } from '../auth/authManager'
import { ConfigManager } from '../auth/configManager'
import { Browser, Page } from 'playwright'
import logger from '../utils/logger'
import { GetNoteDetail, NoteDetail } from './noteDetail'

export interface Note {
  title: string
  content: string
  tags: string[]
  url: string
  author: string
  likes?: number
  collects?: number
  comments?: number
}

export interface Comment {
  author: string
  content: string
  likes: number
  time: string
}

export class RedNoteTools {
  private authManager: AuthManager
  private browser: Browser | null = null
  private page: Page | null = null
  private baseUrl: string = 'https://www.xiaohongshu.com'

  constructor() {
    logger.info('Initializing RedNoteTools')
    this.authManager = new AuthManager()
  }

  async initialize(): Promise<void> {
    logger.info('Initializing browser and page')
    this.browser = await this.authManager.getBrowser()
    if (!this.browser) {
      throw new Error('Failed to initialize browser')
    }

    try {
      this.page = await this.browser.newPage()

      // Load cookies if available
      const cookies = await this.authManager.getCookies()
      if (cookies.length > 0) {
        logger.info(`Loading ${cookies.length} cookies`)
        await this.page.context().addCookies(cookies)
      }

      // Load saved domain config
      const config = await ConfigManager.load()
      this.baseUrl = ConfigManager.getBaseUrl(config)
      logger.info(`Using base URL: ${this.baseUrl}`)

      // Check login status — simple URL-based detection
      logger.info('Checking login status')
      await this.page.goto(`${this.baseUrl}/explore`, { waitUntil: 'domcontentloaded', timeout: 15000 })
      // Wait for redirects to settle (e.g. xiaohongshu.com → rednote.com)
      await this.page.waitForTimeout(3000)

      const currentUrl = this.page.url()
      logger.info(`Current URL after navigation: ${currentUrl}`)

      // Simple check: if on a login page, we're not logged in
      const isLoggedIn = !currentUrl.includes('/login')

      // If not logged in, perform login
      if (!isLoggedIn) {
        logger.error('Not logged in, please login first')
        throw new Error('Not logged in')
      }
      logger.info('Login status verified')
    } catch (error) {
      // 初始化过程中出错，确保清理资源
      await this.cleanup()
      throw error
    }
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up browser resources')
    try {
      if (this.page) {
        await this.page.close().catch(err => logger.error('Error closing page:', err))
        this.page = null
      }
      
      if (this.browser) {
        await this.browser.close().catch(err => logger.error('Error closing browser:', err))
        this.browser = null
      }
    } catch (error) {
      logger.error('Error during cleanup:', error)
    } finally {
      this.page = null
      this.browser = null
    }
  }

  extractRedBookUrl(shareText: string): string {
    // 匹配 http://xhslink.com/ 开头的链接
    const xhslinkRegex = /(https?:\/\/xhslink\.com\/[a-zA-Z0-9\/]+)/i
    const xhslinkMatch = shareText.match(xhslinkRegex)

    if (xhslinkMatch && xhslinkMatch[1]) {
      return xhslinkMatch[1]
    }

    // 匹配 https://www.xiaohongshu.com/ 开头的链接
    const xiaohongshuRegex = /(https?:\/\/(?:www\.)?xiaohongshu\.com\/[^，\s]+)/i
    const xiaohongshuMatch = shareText.match(xiaohongshuRegex)

    if (xiaohongshuMatch && xiaohongshuMatch[1]) {
      return xiaohongshuMatch[1]
    }

    // 匹配 https://www.rednote.com/ 开头的链接
    const rednoteRegex = /(https?:\/\/(?:www\.)?rednote\.com\/[^，\s]+)/i
    const rednoteMatch = shareText.match(rednoteRegex)

    if (rednoteMatch && rednoteMatch[1]) {
      return rednoteMatch[1]
    }

    return shareText
  }

  async searchNotes(keywords: string, limit: number = 10): Promise<Note[]> {
    logger.info(`Searching notes with keywords: ${keywords}, limit: ${limit}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      // Navigate to search page
      logger.info('Navigating to search page')
      await this.page.goto(`${this.baseUrl}/search_result?keyword=${encodeURIComponent(keywords)}`)

      // Wait for search results to load
      logger.info('Waiting for search results')
      await this.page.waitForSelector('.feeds-container', {
        timeout: 30000
      })

      // Get all note items
      let noteItems = await this.page.$$('.feeds-container .note-item')
      logger.info(`Found ${noteItems.length} note items`)
      const notes: Note[] = []

      // Process each note
      for (let i = 0; i < Math.min(noteItems.length, limit); i++) {
        logger.info(`Processing note ${i + 1}/${Math.min(noteItems.length, limit)}`)
        try {
          // Click on the note cover to open detail
          await noteItems[i].$eval('a.cover.mask.ld', (el: HTMLElement) => el.click())

          // Wait for the note page to load
          logger.info('Waiting for note page to load')
          await this.page.waitForSelector('#noteContainer', {
            timeout: 30000
          })

          await this.randomDelay(0.5, 1.5)

          // Extract note content
          const note = await this.page.evaluate(() => {
            const article = document.querySelector('#noteContainer')
            if (!article) return null

            // Get title
            const titleElement = article.querySelector('#detail-title')
            const title = titleElement?.textContent?.trim() || ''

            // Get content
            const contentElement = article.querySelector('#detail-desc .note-text')
            const content = contentElement?.textContent?.trim() || ''

            // Get author info
            const authorElement = article.querySelector('.author-wrapper .username')
            const author = authorElement?.textContent?.trim() || ''

            // Get interaction counts from engage-bar
            const engageBar = document.querySelector('.engage-bar-style')
            const likesElement = engageBar?.querySelector('.like-wrapper .count')
            const likes = parseInt(likesElement?.textContent?.replace(/[^\d]/g, '') || '0')

            const collectElement = engageBar?.querySelector('.collect-wrapper .count')
            const collects = parseInt(collectElement?.textContent?.replace(/[^\d]/g, '') || '0')

            const commentsElement = engageBar?.querySelector('.chat-wrapper .count')
            const comments = parseInt(commentsElement?.textContent?.replace(/[^\d]/g, '') || '0')

            return {
              title,
              content,
              url: window.location.href,
              author,
              likes,
              collects,
              comments
            }
          })

          if (note) {
            logger.info(`Extracted note: ${note.title}`)
            notes.push(note as Note)
          }

          // Add random delay before closing
          await this.randomDelay(0.5, 1)

          // Close note by clicking the close button
          const closeButton = await this.page.$('.close-circle')
          if (closeButton) {
            logger.info('Closing note dialog')
            await closeButton.click()

            // Wait for note dialog to disappear
            await this.page.waitForSelector('#noteContainer', {
              state: 'detached',
              timeout: 30000
            })
          }
        } catch (error) {
          logger.error(`Error processing note ${i + 1}:`, error)
          const closeButton = await this.page.$('.close-circle')
          if (closeButton) {
            logger.info('Attempting to close note dialog after error')
            await closeButton.click()

            // Wait for note dialog to disappear
            await this.page.waitForSelector('#noteContainer', {
              state: 'detached',
              timeout: 30000
            })
          }
        } finally {
          // Add random delay before next note
          await this.randomDelay(0.5, 1.5)
        }
      }

      logger.info(`Successfully processed ${notes.length} notes`)
      return notes
    } catch (error) {
      logger.error('Error searching notes:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  async getNoteContent(url: string): Promise<NoteDetail> {
    logger.info(`Getting note content for URL: ${url}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      const actualURL = this.extractRedBookUrl(url)
      await this.page.goto(actualURL)
      let note = await GetNoteDetail(this.page)
      note.url = url
      logger.info(`Successfully extracted note: ${note.title}`)
      return note
    } catch (error) {
      logger.error('Error getting note content:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  async getNoteComments(url: string): Promise<Comment[]> {
    logger.info(`Getting comments for URL: ${url}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      // Use the original URL — don't rewrite domains
      logger.info(`Navigating to: ${url}`)
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      // Let the page fully render
      await this.page.waitForTimeout(3000)

      // Extract comments with multiple fallback selectors
      logger.info('Extracting comments')
      const comments = await this.page.evaluate(() => {
        const results: Array<{author: string, content: string, likes: number, time: string}> = []

        // Try multiple selector patterns
        const patterns = [
          // xiaohongshu.com pattern
          { item: '[role="dialog"] [role="list"] [role="listitem"]', author: '[data-testid="user-name"]', content: '[data-testid="comment-content"]', likes: '[data-testid="likes-count"]', time: 'time' },
          // Generic pattern: any list structure inside a dialog/modal
          { item: '[role="dialog"] [role="listitem"]', author: '[class*="name"], [class*="author"], [class*="user"]', content: '[class*="content"], [class*="text"], [class*="body"]', likes: '[class*="like"] span, [class*="count"]', time: 'time, [class*="time"], [class*="date"]' },
          // Comment containers
          { item: '[class*="comment-item"], [class*="CommentItem"], .comment', author: '[class*="name"], [class*="author"], [class*="username"]', content: '[class*="content"], [class*="text"], [class*="desc"], p', likes: '[class*="like"] span, [class*="count"], [class*="vote"]', time: 'time, [class*="time"], [class*="date"]' },
          // Ultra-generic: any repeated structure with text
          { item: '[class*="comment"], [class*="reply"]', author: 'a[href], [class*="name"], strong', content: 'p, span, div', likes: '', time: '' },
        ]

        for (const pattern of patterns) {
          const items = document.querySelectorAll(pattern.item)
          if (items.length > 0) {
            items.forEach((item) => {
              const author = pattern.author ? item.querySelector(pattern.author)?.textContent?.trim() || '' : ''
              const content = pattern.content ? item.querySelector(pattern.content)?.textContent?.trim() || '' : ''
              const likesEl = pattern.likes ? item.querySelector(pattern.likes) : null
              const likes = likesEl ? parseInt(likesEl.textContent?.replace(/[^\d]/g, '') || '0') : 0
              const timeEl = pattern.time ? item.querySelector(pattern.time) : null
              const time = timeEl?.textContent?.trim() || ''

              if (content.length > 0) {
                results.push({ author, content, likes, time })
              }
            })
            if (results.length > 0) break
          }
        }

        return results
      })

      logger.info(`Successfully extracted ${comments.length} comments`)
      return comments
    } catch (error) {
      logger.error('Error getting note comments:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  /**
   * Wait for a random duration between min and max seconds
   * @param min Minimum seconds to wait
   * @param max Maximum seconds to wait
   */
  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.random() * (max - min) + min
    logger.debug(`Adding random delay of ${delay.toFixed(2)} seconds`)
    await new Promise((resolve) => setTimeout(resolve, delay * 1000))
  }
}
