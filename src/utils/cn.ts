import { type ClassValue, cn as mergeClassNames } from "cn";

// Registry components resolve their class-name helper through the `utils` alias
// in components.json, so this module has to exist even though shadcn components
// now import `cn` from its own package directly. A thin wrapper keeps the alias
// working without reintroducing clsx + tailwind-merge.
export function cn(...inputs: ClassValue[]): string {
  return mergeClassNames(...inputs);
}
