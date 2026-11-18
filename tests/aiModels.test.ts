import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanupAllUserDataDirs, newUserDataDir } from './helpers';
import { ipcMain } from 'electron';
import { closeDb } from '../electron/db/index';
import { registerIpc } from '../electron/ipc';

const handlers = new Map<Parameters<typeof ipcMain.handle>[0], Parameters<typeof ipcMain.handle>[1]>();

beforeAll(() => {
  newUserDataDir();
  const registration = vi.spyOn(ipcMain, 'handle');
  try {
    registerIpc();
    for (const [channel, handler] of registration.mock.calls) {
      handlers.set(channel, handler);
    }
  } finally {
    registration.mockRestore();
  }
});

afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  closeDb();
  cleanupAllUserDataDirs();
});

const event = {} as Electron.IpcMainInvokeEvent;
const input = { provider: 'chatgpt', token: 'test-token', endpoint: '' };

test('ChatGPT の変換は未設定時に GPT-6.2 Sol を使う', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({ choices: [{ message: { content: '要約' } }] }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(handlers.get('ai:transform')!(event, {
    ...input, model: '', action: 'summarizeWhole', content: '本文',
  })).resolves.toBe('要約');

  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/chat/completions');
  const payload = JSON.parse(request?.body as string);
  expect(payload.model).toBe('gpt-6.2-sol');
  expect(payload).not.toHaveProperty('temperature');
});

test('ChatGPT のチャットは選択したモデルでストリーミングする', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(
    'data: {"choices":[{"delta":{"content":"回答"}}]}\n\ndata: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  ));
  vi.stubGlobal('fetch', fetchMock);

  await expect(handlers.get('ai:chat')!(event, {
    ...input, model: 'gpt-6-luna', messages: [{ role: 'user', content: '質問' }],
  })).resolves.toBe('回答');

  const payload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
  expect(payload).toMatchObject({ model: 'gpt-6-luna', stream: true });
  expect(payload).not.toHaveProperty('temperature');
});

test('Claude は廃止済みの旧既定モデルから Sonnet 5.5 に切り替える', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({ content: [{ type: 'text', text: '要約' }] }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(handlers.get('ai:transform')!(event, {
    ...input, provider: 'claudeCode', model: 'claude-3-5-sonnet-latest',
    action: 'summarizeWhole', content: '本文',
  })).resolves.toBe('要約');

  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.anthropic.com/v1/messages');
  const payload = JSON.parse(request?.body as string);
  expect(payload.model).toBe('claude-sonnet-5-5');
  expect(payload).not.toHaveProperty('temperature');
});

test('Gemini は廃止済みの Flash を置き換え、思考パートを回答に含めない', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({ candidates: [{ content: { parts: [
      { text: '思考', thought: true }, { text: '要約' },
    ] } }] }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(handlers.get('ai:transform')!(event, {
    ...input, provider: 'gemini', model: 'gemini-2.0-flash',
    action: 'summarizeWhole', content: '本文',
  })).resolves.toBe('要約');

  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=test-token');
  expect(JSON.parse(request?.body as string)).not.toHaveProperty('generationConfig');
});

test('Copilot は設定済み接続先と同じオリジンのモデル一覧を使用する', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-b' }] }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(handlers.get('ai:list-copilot-models')!(
    event, 'https://gateway.example/v1/chat/completions', 'test-token',
  )).resolves.toEqual(['model-a', 'model-b']);

  const [url, request] = fetchMock.mock.calls[0];
  expect(String(url)).toBe('https://gateway.example/v1/models');
  expect(request).toMatchObject({
    redirect: 'error', headers: { Authorization: 'Bearer test-token' },
  });
});
