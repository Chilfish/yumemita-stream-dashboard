import { Skeleton } from "@/components/ui/skeleton";

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-10">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton className="h-24 rounded-xl" key={index} />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <p className="text-center text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

export function ViewSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton className="h-20 rounded-lg" key={index} />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
