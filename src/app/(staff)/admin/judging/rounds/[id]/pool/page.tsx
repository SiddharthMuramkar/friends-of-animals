import { RoundPanel } from "../../_components/round-panel";
export const metadata = { robots: { index: false, follow: false } };
export default function Page(
  props: PageProps<"/admin/judging/rounds/[id]/pool">
) {
  return <RoundPanel {...props} tab="pool" />;
}
