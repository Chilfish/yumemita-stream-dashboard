import { TriangleAlert } from "lucide-react";
import { CalendarView } from "@/components/dashboard/calendar/calendar-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { CalendarPageData } from "@/types/calendar";

interface CalendarPageProps {
  data: CalendarPageData | null;
  basePath: string;
}

export function CalendarPage({ data, basePath }: CalendarPageProps) {
  if (!data) {
    return (
      <Alert variant="error">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>日程读取失败</AlertTitle>
        <AlertDescription>
          可以刷新重试；场次列表和相册不受影响。
        </AlertDescription>
      </Alert>
    );
  }

  return <CalendarView basePath={basePath} data={data} showMemberFilter={false} />;
}
