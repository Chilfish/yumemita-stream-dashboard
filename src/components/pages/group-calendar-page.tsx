import { CalendarView } from "@/components/dashboard/calendar-view";
import type { CalendarPageData } from "@/types/calendar";

interface GroupCalendarPageProps {
  calendar: CalendarPageData;
  basePath: string;
}

export function GroupCalendarPage({ calendar, basePath }: GroupCalendarPageProps) {
  return <CalendarView basePath={basePath} data={calendar} showMemberFilter />;
}
