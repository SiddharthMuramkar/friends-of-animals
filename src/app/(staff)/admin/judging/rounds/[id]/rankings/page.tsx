import { RoundPanel } from "../../_components/round-panel";
export const metadata = { robots: { index: false, follow: false } };
export default function Page(
  props: PageProps<"/admin/judging/rounds/[id]/rankings">
) {
  return <RoundPanel {...props} tab="rankings" />;
}
