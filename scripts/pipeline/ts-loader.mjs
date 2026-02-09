import { readFile } from "fs/promises";
import { fileURLToPath } from "url";

export async function load(url, context, defaultLoad) {
  if (url.endsWith(".ts")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    return { format: "module", source, shortCircuit: true };
  }
  return defaultLoad(url, context, defaultLoad);
}
