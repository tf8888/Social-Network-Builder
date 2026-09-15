import { User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Shared between ContactsDashboard's table and SendEmailModal's contact
// picker list.
export default function ContactAvatar({ url, name }: { url: string | null; name: string }) {
  return (
    <Avatar className="size-7">
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback title={name}>
        <User size={14} />
      </AvatarFallback>
    </Avatar>
  );
}
