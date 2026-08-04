export function productionNextEnv(env = process.env, distDir = env.NEXT_DIST_DIR || ".next-production") {
  return {
    ...env,
    NEXT_DIST_DIR: distDir,
  };
}
