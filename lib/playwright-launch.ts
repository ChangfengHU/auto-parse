import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright';

type LaunchPersistentContextOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

type SupportedChannel = 'chrome' | 'msedge';

function getConfiguredChannel(): SupportedChannel | undefined {
  const channel = String(process.env.BROWSER_CHANNEL || '').trim();
  if (channel === 'chrome' || channel === 'msedge') return channel;
  return undefined;
}

function canFallbackToSystemChrome(): boolean {
  return process.env.BROWSER_SYSTEM_CHANNEL_FALLBACK !== 'false';
}

function isMissingBrowserExecutableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes('Please run the following command to download new browsers')
  );
}

export async function launchChromiumBrowser(options: LaunchOptions): Promise<Browser> {
  const configuredChannel = getConfiguredChannel();
  if (configuredChannel) {
    return chromium.launch({ ...options, channel: configuredChannel });
  }

  try {
    return await chromium.launch(options);
  } catch (error) {
    if (!canFallbackToSystemChrome() || !isMissingBrowserExecutableError(error)) {
      throw error;
    }
    return chromium.launch({ ...options, channel: 'chrome' });
  }
}

export async function launchPersistentChromiumContext(
  userDataDir: string,
  options: LaunchPersistentContextOptions
): Promise<BrowserContext> {
  const configuredChannel = getConfiguredChannel();
  if (configuredChannel) {
    return chromium.launchPersistentContext(userDataDir, { ...options, channel: configuredChannel });
  }

  try {
    return await chromium.launchPersistentContext(userDataDir, options);
  } catch (error) {
    if (!canFallbackToSystemChrome() || !isMissingBrowserExecutableError(error)) {
      throw error;
    }
    return chromium.launchPersistentContext(userDataDir, { ...options, channel: 'chrome' });
  }
}
