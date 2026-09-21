type ErrorStateProps = { title: string; message: string };

export function ErrorState({ title, message }: ErrorStateProps) {
  return (
    <div role="alert" className="notice notice-danger">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 break-words">{message}</p>
    </div>
  );
}
