// Device fingerprint exactly shaped like the official Command Code CLI
// (`buildMachineFingerprint` / `hashSignal`, command-code@1.53.1).
//
// The raw signals (MachineGuid, MACs, hostname, git email) are fabricated
// deterministically from the provider key. Only their SHA-256 hashes ever
// leave the Worker. One key always maps to one device, across restarts,
// isolates and re-initialisations.

const FP_SALT = 'command-code:device-fingerprint:v1';

interface CpuProfile {
  model: string;
  threads: number;
}

// cpuCount is the logical processor count (`os.cpus().length`), not cores.
const FINGERPRINT_CPUS: readonly CpuProfile[] = [
  { model: '12th Gen Intel(R) Core(TM) i7-12650H', threads: 16 },
  { model: '12th Gen Intel(R) Core(TM) i5-12400F', threads: 12 },
  { model: '12th Gen Intel(R) Core(TM) i9-12900K', threads: 24 },
  { model: '13th Gen Intel(R) Core(TM) i7-13700K', threads: 24 },
  { model: '13th Gen Intel(R) Core(TM) i5-13600K', threads: 20 },
  { model: '13th Gen Intel(R) Core(TM) i9-13900K', threads: 32 },
  { model: 'Intel(R) Core(TM) Ultra 7 155H', threads: 22 },
  { model: 'Intel(R) Core(TM) Ultra 9 285H', threads: 16 },
  { model: 'Intel(R) Core(TM) i9-14900K', threads: 32 },
  { model: 'Intel(R) Core(TM) i7-14700K', threads: 28 },
  { model: 'AMD Ryzen 7 7800X3D', threads: 16 },
  { model: 'AMD Ryzen 9 7950X', threads: 32 },
  { model: 'AMD Ryzen 5 7600', threads: 12 },
  { model: 'AMD Ryzen 9 7900X', threads: 24 },
  { model: 'AMD Ryzen 7 5800X3D', threads: 16 },
];
const FINGERPRINT_MEMS = [8, 16, 24, 32, 48, 64] as const;
const FINGERPRINT_TZS = [
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Moscow',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Seoul',
  'Asia/Hong_Kong',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;
const FINGERPRINT_MAC_COUNT_RANGE = [2, 3, 4, 5] as const;
const FP_OS_USERS = ['dev', 'user', 'admin', 'coder', 'engineer', 'work'] as const;
const FP_MAIL_DOMAINS = ['gmail.com', 'outlook.com', 'qq.com', '163.com'] as const;

const DEVICE_PROFILE = {
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.22631',
  isContainer: false,
} as const;

interface FingerprintComponents {
  machineIdHash: string;
  macHashes: string[];
  osUserHash: string;
  hostnameHash: string;
  gitEmailHash: string;
  platform: string;
  arch: string;
  osRelease: string;
  cpuModel: string;
  cpuCount: number;
  memGiB: number;
  isContainer: boolean;
  timezone: string;
  runtime: 'cli';
  collectorVersion: 1;
}

interface DeviceFingerprint {
  thumbmark: string;
  components: FingerprintComponents;
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  // Fixed-width digest comparison; Iterator.zip does not apply here.
  // eslint-disable-next-line unicorn/prefer-iterator-zip
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

async function fingerprintHash(value: string): Promise<string> {
  const trimmed = (value ?? '').trim();
  return trimmed ? toHex(await sha256Bytes(`${FP_SALT}\0${trimmed.toLowerCase()}`)) : '';
}

async function pickIndex(secret: string, salt: string, field: string, count: number, label: (index: number) => string): Promise<number> {
  let bestIndex = 0;
  let bestScore: Uint8Array | null = null;
  for (let index = 0; index < count; index += 1) {
    const score = await sha256Bytes(`${salt}\0${secret}\0${field}\0${label(index)}`);
    if (bestScore && compareBytes(score, bestScore) <= 0) {
      continue;
    }

    bestScore = score;
    bestIndex = index;
  }
  return bestIndex;
}

async function generateFingerprint(secret: string, salt = ''): Promise<DeviceFingerprint> {
  const cpuIndex = await pickIndex(secret, salt, 'cpu', FINGERPRINT_CPUS.length, (index) => {
    const cpu = FINGERPRINT_CPUS[index];
    return `${cpu.model}|${cpu.threads}`;
  });
  const cpu = FINGERPRINT_CPUS[cpuIndex];
  const memGiB =
    FINGERPRINT_MEMS[await pickIndex(secret, salt, 'mem', FINGERPRINT_MEMS.length, (index) => String(FINGERPRINT_MEMS[index]))];
  const timezone = FINGERPRINT_TZS[await pickIndex(secret, salt, 'timezone', FINGERPRINT_TZS.length, (index) => FINGERPRINT_TZS[index])];
  const macCount =
    FINGERPRINT_MAC_COUNT_RANGE[
      await pickIndex(secret, salt, 'macCount', FINGERPRINT_MAC_COUNT_RANGE.length, (index) => String(FINGERPRINT_MAC_COUNT_RANGE[index]))
    ];
  const osUser = FP_OS_USERS[await pickIndex(secret, salt, 'osUser', FP_OS_USERS.length, (index) => FP_OS_USERS[index])];
  const mailDomain =
    FP_MAIL_DOMAINS[await pickIndex(secret, salt, 'mailDomain', FP_MAIL_DOMAINS.length, (index) => FP_MAIL_DOMAINS[index])];

  const hex = async (field: string, bytes: number): Promise<string> => {
    const digest = await sha256Bytes(`${salt}\0${secret}\0${field}`);
    return toHex(digest.subarray(0, bytes));
  };
  const machineHex = await hex('machineId', 16);
  const machineId = `${machineHex.slice(0, 8)}-${machineHex.slice(8, 12)}-${machineHex.slice(12, 16)}-${machineHex.slice(16, 20)}-${machineHex.slice(20, 32)}`;
  const macs: string[] = [];
  for (let index = 0; index < macCount; index += 1) {
    const digest = await sha256Bytes(`${salt}\0${secret}\0mac${index}`);
    const bytes = digest.subarray(0, 6);
    macs.push([...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(':'));
  }
  macs.sort((a, b) => a.localeCompare(b));
  const hostnameHex = await hex('hostname', 4);
  const hostname = `DESKTOP-${hostnameHex.toUpperCase()}`;
  const gitEmail = `${osUser}.${await hex('gitEmail', 3)}@${mailDomain}`;

  const machineIdHash = await fingerprintHash(machineId);
  const macHashes: string[] = [];
  for (const mac of macs) {
    const hash = await fingerprintHash(mac);
    if (hash) macHashes.push(hash);
  }
  const osUserHash = await fingerprintHash(osUser);
  const hostnameHash = await fingerprintHash(hostname);
  const gitEmailHash = await fingerprintHash(gitEmail);

  const thumbSeed = [machineId.trim(), macs.join(','), machineId.trim() ? '' : hostname, machineId.trim() ? '' : cpu.model].filter(Boolean);
  const thumbmark = toHex(await sha256Bytes(`${FP_SALT}\0machine\0${thumbSeed.join('|') || 'unknown'}`));

  return {
    thumbmark,
    components: {
      machineIdHash,
      macHashes,
      osUserHash,
      hostnameHash,
      gitEmailHash,
      platform: DEVICE_PROFILE.platform,
      arch: DEVICE_PROFILE.arch,
      osRelease: DEVICE_PROFILE.osRelease,
      cpuModel: cpu.model,
      cpuCount: cpu.threads,
      memGiB,
      isContainer: DEVICE_PROFILE.isContainer,
      timezone,
      runtime: 'cli',
      collectorVersion: 1,
    },
  };
}

export { DEVICE_PROFILE, FINGERPRINT_CPUS, generateFingerprint, sha256Bytes, toHex };
export type { DeviceFingerprint, FingerprintComponents };
