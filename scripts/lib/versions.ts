import type { System } from "../../shared/universe-types.ts";

/**
 * True for pre-release / nightly / canary / snapshot builds.
 *  - semver ecosystems (npm, cargo, go, nuget): any "-suffix" (build metadata after "+" is ignored).
 *    Go pseudo-versions (v0.0.0-2019...-abcdef) are also caught.
 *  - pypi (PEP 440): a/b/c/rc/alpha/beta/pre/preview/dev segments ("post" releases are stable).
 *  - maven: SNAPSHOT, alpha, beta, rc, milestone (M1), cr, ea qualifiers.
 */
export function isPrerelease(system: System, version: string): boolean {
  const v = version.split("+")[0]!;
  switch (system) {
    case "pypi": {
      const s = v.replace(/^\d+!/, "");
      return /^\d+(?:\.\d+)*[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview)[-_.]?\d*/i.test(s) || /[-_.]?dev[-_.]?\d*/i.test(s);
    }
    case "maven":
      return /[-.](?:snapshot|alpha|beta|rc|cr|ea|m\d+)/i.test(v);
    default:
      return v.includes("-");
  }
}