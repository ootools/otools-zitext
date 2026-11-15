/**
 * 六平台 / 架构分包矩阵。
 * ------------------------------------------------------------------
 * 与 otools-fileshare / otools-releasehub 的分包约定保持一致：
 * Release 里放 <packid>-<version>-<suffix>.oplg，市场侧用对应的
 * packageUrl* 字段，并置 packageMode=1（客户端按平台优先下载，失败回退）。
 *
 * 本插件是纯 webview、没有 native 动态库，六个包的内容因此完全相同；
 * 仍然按平台出包是为了与市场其他独立插件的发布形态一致，并让以后
 * 引入平台相关资源时不必改发布协议。
 */
export const PLATFORM_TARGETS = [
    { id: 'macos-arm64', platform: 'macos', arch: 'arm64', suffix: 'macos', field: 'packageUrlMacos' },
    { id: 'macos-x64', platform: 'macos', arch: 'x64', suffix: 'macos-intel', field: 'packageUrlMacosIntel' },
    { id: 'windows-x64', platform: 'windows', arch: 'x64', suffix: 'windows', field: 'packageUrlWindows' },
    { id: 'windows-arm64', platform: 'windows', arch: 'arm64', suffix: 'windows-arm', field: 'packageUrlWindowsArm' },
    { id: 'linux-x64', platform: 'linux', arch: 'x64', suffix: 'linux', field: 'packageUrlLinux' },
    { id: 'linux-arm64', platform: 'linux', arch: 'arm64', suffix: 'linux-arm', field: 'packageUrlLinuxArm' },
];

export function platformPackageName(packid, version, suffix) {
    return `${packid}-${version}-${suffix}.oplg`;
}

export function combinedPackageName(packid, version) {
    return `${packid}-${version}.oplg`;
}

/** 给定发布模式，返回本次应该出现的全部 .oplg 文件名。 */
export function expectedPackageNames(packid, version, platformPackages) {
    return platformPackages
        ? PLATFORM_TARGETS.map((target) => platformPackageName(packid, version, target.suffix))
        : [combinedPackageName(packid, version)];
}
