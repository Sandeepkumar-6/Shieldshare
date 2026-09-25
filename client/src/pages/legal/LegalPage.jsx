// Shared frame for the privacy policy and terms (skill §43): plain language, no compliance
// claims, clearly marked as a hackathon project.
export function LegalPage({ title, updated, intro, sections }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <header className="border-b border-line-subtle pb-6">
        <h1 className="text-display font-semibold text-fg">{title}</h1>
        <p className="mt-2 text-meta text-fg-muted">Last updated {updated}</p>
        <p className="mt-4 rounded-card border border-warning/30 bg-warning/5 px-4 py-3 text-body text-fg-secondary">
          ShieldShare is a hackathon project, not a commercial service. It has not been audited and makes
          no claim of compliance with any standard or regulation. Do not use it for sensitive or real
          personal data.
        </p>
        {intro && <p className="mt-4 text-body text-fg-secondary">{intro}</p>}
      </header>
      <nav aria-label="On this page" className="border-b border-line-subtle py-4">
        <ol className="flex flex-col gap-1 text-body">
          {sections.map((section, index) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-fg-secondary hover:text-fg">{index + 1}. {section.title}</a>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map((section, index) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-6 border-b border-line-subtle py-6 last:border-b-0">
          <h2 id={`${section.id}-title`} className="text-heading font-semibold text-fg">{index + 1}. {section.title}</h2>
          <div className="mt-3 flex flex-col gap-3 text-body text-fg-secondary [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
            {section.content}
          </div>
        </section>
      ))}
    </article>
  );
}
