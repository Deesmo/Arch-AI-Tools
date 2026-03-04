export default function VerifyPage() {
  return (
    <div className="pt-14">
      <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Verified</h1>
      <p className="mt-3 max-w-2xl text-white/70">If you opened a magic link, your email is now verified and your monthly free credits can be granted.</p>
      <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/70">
        Next step: register an agent and generate an API key. Use <code className="rounded bg-black/40 px-1">POST /v1/agent/register</code>.
      </div>
    </div>
  )
}
