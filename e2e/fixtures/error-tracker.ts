// 测试期间的 console error / page error / network 4xx-5xx 监听器。
//
// **生产级 e2e 标尺**：UI 看起来工作 ≠ 后端真成功。如果 POST /api/comments
// 返 500 但 client 静默 swallow，UI 显示 pin 但数据没真存——只验 UI 的 spec
// 会假阳性。
//
// 用法（playwright fixture）：
//
//   import { test, expect } from '../fixtures/test-with-tracker';
//
//   test('foo', async ({ page, errorTracker }) => {
//     // ... 测试逻辑 ...
//     // afterEach 自动 assert 没有未预期错误
//   });
//
//   // 如果 case 故意触发错误（如 error-paths spec 的 5xx case）：
//   test('expects 500', async ({ page, errorTracker }) => {
//     errorTracker.acknowledge({
//       network: [{ urlPattern: /\/api\/projects/, status: 500 }],
//     });
//     // ... 测试期望 5xx 行为 ...
//   });

import type { Page, Request } from '@playwright/test';

export interface NetworkError {
  url: string;
  status: number;
  method: string;
  // 哪个 spec method 主动 acknowledge 了这个错误（用于 debug）
  acknowledged?: boolean;
}

export interface AcknowledgePattern {
  /** URL 正则；e.g. /\/api\/projects\/.+\/comments$/ */
  urlPattern?: RegExp;
  /** Status code（如 500），不传等于任意 4xx/5xx */
  status?: number;
  /** HTTP method（GET / POST / PUT / DELETE / PATCH） */
  method?: string;
  /** Console error 文本正则 */
  consoleTextPattern?: RegExp;
  /** Page error message 正则 */
  pageErrorPattern?: RegExp;
}

export interface UnexpectedErrors {
  console: string[];
  page: string[];
  network: NetworkError[];
}

export interface ErrorTracker {
  /** 标记某个/某类 error 是预期的，afterEach assert 时跳过 */
  acknowledge(opts: {
    console?: AcknowledgePattern[];
    page?: AcknowledgePattern[];
    network?: AcknowledgePattern[];
  }): void;

  /** 当前已经接到的 unexpected errors（filter 后） */
  getUnexpected(): UnexpectedErrors;

  /** 全部 raw 数据（debug 用） */
  getRaw(): {
    console: string[];
    page: string[];
    network: NetworkError[];
  };
}

// 全局默认 ignore：跨 spec 共享的、确实无意义的 noise
const DEFAULT_CONSOLE_IGNORE: RegExp[] = [
  /\[vite\]/i, // vite dev hmr 提示
  /Download the React DevTools/i, // React 开发工具提示
  /\[HMR\]/, // hot module reload
  /Mocking model adapter/, // mock 自身的注释
];

const DEFAULT_NETWORK_IGNORE: Array<{ urlPattern?: RegExp; status?: number }> = [
  { urlPattern: /favicon/, status: 404 }, // 浏览器自动请求 favicon
  { urlPattern: /\.well-known/, status: 404 }, // chrome devtools probe
  { urlPattern: /node_modules\/\.vite/, status: 404 }, // vite 预编译 cache miss
];

export function attachErrorTrackers(page: Page): ErrorTracker {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const networkErrors: NetworkError[] = [];

  const acknowledged = {
    console: [] as AcknowledgePattern[],
    page: [] as AcknowledgePattern[],
    network: [] as AcknowledgePattern[],
  };

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    const stack = err.stack ? `\n${err.stack}` : '';
    pageErrors.push(`${err.name}: ${err.message}${stack}`);
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status < 400) return;
    const request: Request = response.request();
    networkErrors.push({
      url: response.url(),
      status,
      method: request.method(),
    });
  });

  function isConsoleAcked(text: string): boolean {
    if (DEFAULT_CONSOLE_IGNORE.some((p) => p.test(text))) return true;
    return acknowledged.console.some((p) => {
      if (p.consoleTextPattern && !p.consoleTextPattern.test(text)) return false;
      return true;
    });
  }

  function isPageAcked(text: string): boolean {
    return acknowledged.page.some((p) => {
      if (p.pageErrorPattern && !p.pageErrorPattern.test(text)) return false;
      return true;
    });
  }

  function isNetworkAcked(err: NetworkError): boolean {
    if (
      DEFAULT_NETWORK_IGNORE.some(
        (p) =>
          (!p.urlPattern || p.urlPattern.test(err.url)) && (!p.status || p.status === err.status),
      )
    ) {
      return true;
    }
    return acknowledged.network.some((p) => {
      if (p.urlPattern && !p.urlPattern.test(err.url)) return false;
      if (p.status !== undefined && p.status !== err.status) return false;
      if (p.method && p.method.toUpperCase() !== err.method.toUpperCase()) return false;
      return true;
    });
  }

  return {
    acknowledge(opts) {
      if (opts.console) acknowledged.console.push(...opts.console);
      if (opts.page) acknowledged.page.push(...opts.page);
      if (opts.network) acknowledged.network.push(...opts.network);
    },

    getUnexpected() {
      return {
        console: consoleErrors.filter((e) => !isConsoleAcked(e)),
        page: pageErrors.filter((e) => !isPageAcked(e)),
        network: networkErrors.filter((e) => !isNetworkAcked(e)),
      };
    },

    getRaw() {
      return {
        console: [...consoleErrors],
        page: [...pageErrors],
        network: [...networkErrors],
      };
    },
  };
}
