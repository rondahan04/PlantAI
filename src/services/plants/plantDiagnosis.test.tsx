/*
 * The cloud-photo path through `diagnosePlant`.
 *
 * WHY THIS FILE IS .tsx WITH NO JSX IN IT. The two suites are split by
 * extension, not by folder: `node --test` runs every `*.test.ts` with Node's
 * type stripping and no Babel, so it cannot load a module that imports
 * expo-file-system. Jest owns `*.test.tsx`. This test needs to mock a native
 * module, so it has to live on the jest side, and the extension is what puts it
 * there. See ScheduleCard.test.tsx for the other half of the same split.
 *
 * WHAT IT PINS. A logged-in user's `photoUri` is a signed HTTPS URL, because
 * `supabasePlantCloud.fetchAll` resolves every stored path to one so <Image>
 * can render it. `readAsStringAsync` reads local files only, so it threw on
 * every one of them - and `bulkDiagnose` caught the throw per plant, counted a
 * failure and moved on. "Diagnose all" therefore did nothing at all for anyone
 * with an account, silently. The unit test in lib/remoteUri covers the
 * decision; this covers the wiring, which is where the bug actually was.
 */

/* Imported rather than taken from the global scope, exactly as
 * ScheduleCard.test.tsx does and for the same reason: `node --test` also
 * defines `describe`/`it`, and the two runners mean different things by them. */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockReadAsString = jest.fn<(uri: string, options: unknown) => Promise<string>>();
const mockDownload = jest.fn<(uri: string, into: string) => Promise<{ status: number }>>();
const mockDelete = jest.fn<(uri: string, options: unknown) => Promise<void>>();

/* The factory names must start with `mock` - jest hoists jest.mock above the
 * imports, so anything else it closes over is not defined yet. */
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  readAsStringAsync: (...args: [string, unknown]) => mockReadAsString(...args),
  downloadAsync: (...args: [string, string]) => mockDownload(...args),
  deleteAsync: (...args: [string, unknown]) => mockDelete(...args),
}));

const mockApiFetch = jest.fn<(path: string, init: { body: string }) => Promise<Response>>();
jest.mock('../../lib/api', () => ({
  apiFetch: (path: string, init: { body: string }) => mockApiFetch(path, init),
  apiHeaders: (h: Record<string, string>) => h,
  readApiError: async () => ({ error: 'boom' }),
}));

jest.mock('../language', () => ({ getLanguage: () => 'en' }));

import { DiagnosisServiceError, diagnosePlant } from './plantDiagnosis';

const SIGNED_URL =
  'https://amehahtaiggookgekfjt.supabase.co/storage/v1/object/sign/plants/u/abc.jpg?token=ey';

const DIAGNOSIS = {
  plantName: 'Mini monstera',
  scientificName: 'Rhaphidophora tetrasperma',
  condition: 'moderate',
  conditionLabel: 'Moderate stress',
  issues: [],
  treatments: [],
  canBeSaved: true,
  confidence: 47,
  description: 'A plant.',
};

function okResponse() {
  return { ok: true, json: async () => DIAGNOSIS } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
  mockReadAsString.mockResolvedValue('BASE64BYTES');
  mockDownload.mockResolvedValue({ status: 200 });
  mockDelete.mockResolvedValue(undefined);
  mockApiFetch.mockResolvedValue(okResponse());
});

describe('diagnosePlant, given a cloud photo', () => {
  it('downloads the signed URL instead of reading it as a file', async () => {
    // The bug in one assertion: the signed URL must never reach the file reader.
    await diagnosePlant(SIGNED_URL);

    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload.mock.calls[0][0]).toBe(SIGNED_URL);
    expect(mockReadAsString).toHaveBeenCalledTimes(1);
    expect(mockReadAsString.mock.calls[0][0]).not.toBe(SIGNED_URL);
    expect(mockReadAsString.mock.calls[0][0]).toContain('file:///cache/');
  });

  it('sends the downloaded bytes and returns the diagnosis', async () => {
    const result = await diagnosePlant(SIGNED_URL);

    expect(result.plantName).toBe('Mini monstera');
    const body = JSON.parse((mockApiFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.imageBase64).toBe('BASE64BYTES');
  });

  it('deletes the staged copy, including when the upload fails', async () => {
    // A temp file per diagnosis that is never removed is a slow storage leak on
    // a phone, and the failure path is the one that would leak.
    mockApiFetch.mockRejectedValueOnce(new Error('offline'));

    await expect(diagnosePlant(SIGNED_URL)).rejects.toBeInstanceOf(DiagnosisServiceError);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('treats an expired signed URL as a service error, not a broken plant', async () => {
    mockDownload.mockResolvedValueOnce({ status: 400 });

    await expect(diagnosePlant(SIGNED_URL)).rejects.toBeInstanceOf(DiagnosisServiceError);
    // Nothing was uploaded, so nothing was paid for.
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});

describe('diagnosePlant, given a local photo', () => {
  it('reads the file directly and downloads nothing', async () => {
    // The camera path must be exactly as it was - this is the flow that already
    // worked, and it is the one a regression here would break.
    await diagnosePlant('file:///var/mobile/plant.jpg');

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockReadAsString.mock.calls[0][0]).toBe('file:///var/mobile/plant.jpg');
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
