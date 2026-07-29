import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(frontendRoot, 'public');
const failures = [];

const assertFile = async (relativePath, source) => {
  const normalized = relativePath.replace(/^\/+/, '');
  const resolved = path.resolve(publicRoot, normalized);

  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) {
    failures.push(`${source}: مسیر خارج از public است: ${relativePath}`);
    return;
  }

  try {
    await access(resolved);
  } catch {
    failures.push(`${source}: فایل public پیدا نشد: ${normalized}`);
  }
};

const indexHtml = await readFile(path.join(frontendRoot, 'index.html'), 'utf8');
const htmlPublicReferences = [
  ...indexHtml.matchAll(/(?:href|content)="%BASE_URL%([^"#?]+)"/g),
].map((match) => match[1]);

for (const reference of htmlPublicReferences) {
  await assertFile(reference, 'index.html');
}

const manifestPath = path.join(publicRoot, 'site.webmanifest');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
for (const icon of manifest.icons ?? []) {
  if (typeof icon.src === 'string') {
    await assertFile(icon.src, 'site.webmanifest');
  }
}

const sourceFiles = [];
const collectSourceFiles = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectSourceFiles(entryPath);
    else if (/\.(?:ts|tsx|css)$/.test(entry.name)) sourceFiles.push(entryPath);
  }
};
await collectSourceFiles(path.join(frontendRoot, 'src'));

const legacyAssetPattern = /(?:from\s+['"]\.\/image\.png['"]|['"]\/image\.png['"])/;
for (const sourceFile of sourceFiles) {
  const content = await readFile(sourceFile, 'utf8');
  if (legacyAssetPattern.test(content)) {
    failures.push(`${path.relative(frontendRoot, sourceFile)}: ارجاع قدیمی image.png هنوز باقی مانده است.`);
  }
}

if (failures.length > 0) {
  console.error(`\nPublic asset validation failed:\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  console.log(`Public assets are valid (${htmlPublicReferences.length} HTML references, ${manifest.icons?.length ?? 0} manifest icons).`);
}

