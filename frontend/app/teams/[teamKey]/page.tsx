import { TeamProfilePage } from "@/components/team-profile-page";

interface PageProps {
  params: Promise<{ teamKey: string }>;
}

export default async function TeamProfileRoute(props: PageProps) {
  const params = await props.params;
  return <TeamProfilePage encodedTeamKey={params.teamKey} />;
}
