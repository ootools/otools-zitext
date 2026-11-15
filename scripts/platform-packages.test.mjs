import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_TARGETS, combinedPackageName, expectedPackageNames, platformPackageName } from './platform-packages.mjs';

test('six targets cover every OS/arch once with distinct suffixes and market fields', () => {
    assert.equal(PLATFORM_TARGETS.length, 6);
    assert.deepEqual(
        PLATFORM_TARGETS.map((target) => `${target.platform}-${target.arch}`).sort(),
        ['linux-arm64', 'linux-x64', 'macos-arm64', 'macos-x64', 'windows-arm64', 'windows-x64'],
    );
    assert.equal(new Set(PLATFORM_TARGETS.map((target) => target.suffix)).size, 6);
    assert.equal(new Set(PLATFORM_TARGETS.map((target) => target.field)).size, 6);
});

test('package names follow the release asset convention used by the market', () => {
    assert.equal(platformPackageName('p', '1.0.0', 'windows-arm'), 'p-1.0.0-windows-arm.oplg');
    assert.equal(combinedPackageName('p', '1.0.0'), 'p-1.0.0.oplg');
    assert.deepEqual(expectedPackageNames('p', '1.0.0', true), [
        'p-1.0.0-macos.oplg',
        'p-1.0.0-macos-intel.oplg',
        'p-1.0.0-windows.oplg',
        'p-1.0.0-windows-arm.oplg',
        'p-1.0.0-linux.oplg',
        'p-1.0.0-linux-arm.oplg',
    ]);
    assert.deepEqual(expectedPackageNames('p', '1.0.0', false), ['p-1.0.0.oplg']);
});
