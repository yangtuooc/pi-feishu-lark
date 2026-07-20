import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** 将 .js 说明符映射到同目录 .ts，便于 node --experimental-strip-types 跑测试 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const tsPath = join(parentDir, specifier.replace(/\.js$/, ".ts"));
    if (existsSync(tsPath)) {
      return {
        shortCircuit: true,
        url: pathToFileURL(tsPath).href,
        format: "module",
      };
    }
  }
  return nextResolve(specifier, context);
}
