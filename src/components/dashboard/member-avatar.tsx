import { readableOn } from "@/lib/color";
import { assetUrl, cn } from "@/lib/utils";

interface MemberAvatarProps {
  label: string;
  avatar?: string | null;
  /** 原始成员色，只用于缺图时的首字底色，不做明暗偏移。 */
  color: string;
  className?: string;
}

/**
 * 组视图里的成员头像：有图用图，缺图用成员色首字。
 * 头像始终是装饰性的——成员名就在旁边，重复一遍只会拉长朗读。
 */
export function MemberAvatar({ label, avatar, color, className }: MemberAvatarProps) {
  if (avatar) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={cn("size-6 shrink-0 rounded-full object-cover", className)}
        src={assetUrl(avatar)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold",
        className,
      )}
      style={{ backgroundColor: color, color: readableOn(color) }}
    >
      {label.slice(0, 1)}
    </span>
  );
}

interface MemberDotProps {
  color: string;
  className?: string;
}

/** 成员强调点：直接用原始 `memberColor`，是页面里唯一不换成 ink 的色块。 */
export function MemberDot({ color, className }: MemberDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}
