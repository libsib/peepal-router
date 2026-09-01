import { RadixRouter } from '../../src/radix';
import type { RouterInstance } from './interface';

// The radix router (src/radix.ts): static routes are resolved at insert time
// into per-method Maps, so a static hit is one Map.get with no traversal.
// Param/wildcard routes fall through to a backtracking tree walk.
export class PeepalRadixRouter implements RouterInstance {
  private router = new RadixRouter();

  add(method: string, path: string, handler: any) {
    this.router.add(method, path, handler);
  }

  find(method: string, path: string) {
    return this.router.find(method, path);
  }
}
