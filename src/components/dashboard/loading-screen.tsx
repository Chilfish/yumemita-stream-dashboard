import { Skeleton } from "@/components/ui/skeleton";

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[82.5rem] flex-col gap-6 px-4 py-10 md:px-6">
      <div className="flex flex-col gap-2 border-b border-hairline pb-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel bg-hairline md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton className="h-20 rounded-none" key={index} />
        ))}
      </div>
      <Skeleton className="h-72 rounded-panel" />
      <p className="text-center text-footnote text-muted-foreground">{label}</p>
    </div>
  );
}

export function ViewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 border-b border-hairline pb-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel bg-hairline md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton className="h-20 rounded-none" key={index} />
        ))}
      </div>
      <Skeleton className="h-72 rounded-panel" />
    </div>
  );
}
