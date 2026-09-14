import type { ReactNode } from "react";
import { Link } from "../router";

// These are public policy details, never OAuth credentials.
export const legalDetails = {
  operator: "Eclipse Development Studio",
  location: "Australia",
  contactEmail: "contact@towereclipse.com",
  effectiveDate: "14 September 2026",
};

export function PrivacyContact() {
  return legalDetails.contactEmail
    ? <a href={`mailto:${legalDetails.contactEmail}`}>{legalDetails.contactEmail}</a>
    : <span className="legal-pending">Contact address awaiting operator confirmation</span>;
}

export interface LegalSection { id: string; title: string; content: ReactNode }
export interface LegalDocument { title: string; description: string; summary: string[]; sections: LegalSection[] }

export const privacyPolicy: LegalDocument = {
  title: "Privacy Policy",
  description: "What we collect, why we need it, and the choices you have about your information.",
  summary: [
    "Discord provides your website identity and community role.",
    "Roblox linking is optional and saves your verified username and user ID.",
    "Submitted bug reports and their discussions can be viewed publicly.",
    "You can unlink Roblox in your account and contact us about your data.",
  ],
  sections: [
    { id: "who-we-are", title: "Who we are", content: <>
      <p>{legalDetails.operator} operates the Tower Eclipse website at towereclipse.com and the TE Accounts connection app. {legalDetails.location && `We operate from ${legalDetails.location}.`} This policy covers the website, its account features, and information we receive through its connected services.</p>
      <p>The Tower Eclipse Roblox experience and services you visit through external links may process additional information under their own notices. This website’s account-linking feature does not import your saved game progress.</p>
      <p>For privacy questions, requests, or complaints, contact <PrivacyContact />.</p>
    </> },
    { id: "information", title: "Information we collect", content: <>
      <ul>
        <li><strong>Discord sign-in:</strong> your Discord user ID, username, display name, avatar, and membership information for the Tower Eclipse Discord server, including your nickname and roles. We record your first website account date and use your roles to determine access.</li>
        <li><strong>Optional Roblox connection:</strong> when you authorize Roblox, we receive profile information and retain your Roblox user ID, username, the Discord account it belongs to, and the dates it was linked and last verified. We do not retain Roblox access or refresh tokens after completing the link.</li>
        <li><strong>Content and activity:</strong> reports, comments, attachments, review decisions, report changes, author details and dates, and which account updates you have marked as read. Authorized staff may also record internal report notes. Tournament records can include participant names, ratings, attendance, placements, and match results entered by organizers.</li>
        <li><strong>Sign-in and security information:</strong> session identifiers, temporary authorization state, and Discord authorization tokens needed to keep your session working. Our servers and service providers also process connection information such as IP addresses, browser details, request times, and errors to deliver and protect the website.</li>
        <li><strong>Support correspondence:</strong> the contact details and information you provide when you ask for help or make a privacy request.</li>
        <li><strong>Team applications:</strong> the opening and form version you apply to, your answers, your Discord and verified Roblox identities at submission, submission and review dates, privacy-notice acknowledgment, status, feedback, and internal reviewer notes. Linking Roblox is required if you choose to apply. Answers are sent to our database when you submit, not as you type.</li>
      </ul>
      <p>We do not ask for your Discord or Roblox password. Authentication takes place with those services. Avoid including private messages, passwords, payment information, or other people’s personal information in reports or screenshots.</p>
    </> },
    { id: "use", title: "How we use information", content: <>
      <p>We use this information to provide accounts, check community permissions, verify account connections, investigate bugs, show report updates and contribution statistics, operate tournaments, respond to requests, and prevent misuse. Account statistics summarize reports already submitted to this website.</p>
      <p>We do not sell personal information or use Roblox account information for advertising, cross-experience tracking, or training AI models. Connecting Roblox does not authorize purchases, messages, changes to your game account, or background access to your saved game data.</p>
    </> },
    { id: "visibility", title: "What other people can see", content: <>
      <p>Career openings are public. Application answers and review updates are private to the applicant and authorized website admins and developers reviewing applications. Internal reviewer notes are not shown to applicants. We use application information to evaluate suitability, manage recruitment, prevent duplicate submissions, and communicate decisions through your account.</p>
      <p>Submitted bug reports, their comments, ready attachments, and public change histories can be read by visitors, including people who are signed out. These records include the author’s Discord identity, such as display name, username, avatar, user ID, and role. Pending approval or rejected reports are not automatically private.</p>
      <p>Unfinished report uploads are restricted to their author and developers. Internal developer notes are available to authorized developers and QA leads. Published tournament information and results are public.</p>
      <p>Your account dashboard, linked Roblox identity, and personal notification feed are returned to your signed-in account. Authorized operators may access stored records when necessary to operate, secure, or support the service. The website currently has no public user-profile directory.</p>
    </> },
    { id: "providers", title: "Services that help run the website", content: <>
      <p>We use Google Firebase/Firestore for website records, Cloudflare R2 for uploaded files, and hosting infrastructure to run the website and its backend. These providers process information needed to supply storage, delivery, security, and operational support.</p>
      <p>Discord processes sign-in and serves account avatars. Roblox processes the optional authorization flow. Where externally hosted fonts load, Google Fonts receives the browser request. These providers may process information in countries other than your own, including the United States, depending on their infrastructure and our hosting configuration.</p>
      <p>External websites you choose to visit, including Roblox, Discord, video sites, registration services, and support or membership platforms, have their own terms and privacy practices. We may also disclose information when reasonably necessary to comply with law or protect people and the service.</p>
    </> },
    { id: "cookies", title: "Cookies and sign-in", content: <>
      <p>The website uses necessary cookies to recognize your signed-in session and protect the Discord authorization process. Session cookies contain a signed identifier; Discord authorization tokens are kept on the server rather than exposed in the cookie. Sessions expire, and signing out removes the active website session.</p>
      <p>You can block or clear cookies in your browser, but sign-in and connected account features will not work without them. We do not use advertising cookies in the website application.</p>
    </> },
    { id: "retention", title: "Storage, retention, and security", content: <>
      <p>Applications and internal review notes are kept for recruitment, follow-up, and handling questions or disputes about a decision. They are not automatically deleted when an opening closes, an application is withdrawn, or Roblox is unlinked. Saved applications retain the identities verified at submission and the latest 50 status and feedback updates. Contact us to request access, correction, or deletion, including application records.</p>
      <p>Account records remain while your website account is maintained. We keep reports, discussions, and moderation or tournament history while they remain useful for development, community records, security, and resolving disputes. These records are not automatically deleted when you sign out or unlink Roblox.</p>
      <p>Unlinking Roblox removes the connection and ownership record from the active website database. A deletion request may also require removing identifying details from reports and historical records. We may retain limited information where required by law or necessary to address abuse or a dispute, and will explain an applicable exception when responding.</p>
      <p>Service-provider backups and operational logs may retain copies for their applicable retention periods. We use access restrictions, encrypted transport in production, and encrypted server-side session storage to protect information. No online service can promise complete security.</p>
    </> },
    { id: "choices", title: "Your choices and requests", content: <>
      <p>You can use public pages without signing in. You can choose not to link Roblox, refresh its saved username through <strong>Account → Connections → Update link</strong>, or remove the association through <strong>Unlink</strong>. Roblox’s own app authorization can be revoked separately in Roblox account settings.</p>
      <p>To request access to, correction of, or deletion of your website information, email <PrivacyContact />. Include your Discord user ID and a description of the request. We may ask you to verify control of the relevant account; we will not ask for its password. Account deletion requests are handled by the team, not by the Sign out button.</p>
      <p>Depending on where you live, you may also have rights to object to or restrict processing, obtain a portable copy, or withdraw consent where processing relies on it. We will respond within the period required by applicable law and explain any information we cannot remove. Contact us first with a privacy complaint so we can investigate; you may also contact your local privacy regulator. In Australia, information about privacy complaints is available from the <a href="https://www.oaic.gov.au/privacy/privacy-complaints" target="_blank" rel="noopener noreferrer">Office of the Australian Information Commissioner</a>.</p>
    </> },
    { id: "young-users", title: "Young users", content: <>
      <p>Website account features are intended for people aged 13 or older who meet the age and eligibility rules of Discord and, when linking, Roblox. Higher local minimum ages still apply. If parental or guardian permission is required where you live, obtain it before using these features.</p>
      <p>If you believe a child below the applicable minimum age has supplied personal information through an account, contact us so we can investigate and remove it where appropriate.</p>
    </> },
    { id: "changes", title: "Changes to this policy", content: <>
      <p>We will update this page when our information practices change and show the effective date above. We will provide an additional notice for material changes where appropriate and obtain further permission when required. Planned features, including personal in-game statistics, will need an updated notice before we introduce additional data collection.</p>
    </> },
  ],
};

export const termsOfService: LegalDocument = {
  title: "Terms of Service",
  description: "The ground rules for using the Tower Eclipse website and connected account features.",
  summary: [
    "Use accounts you control and respect other members of the community.",
    "Reports and contributions must be lawful and safe to share.",
    "Roblox linking verifies your identity; it does not grant game rewards or staff access.",
    "Your rights under applicable consumer and privacy laws still apply.",
  ],
  sections: [
    { id: "agreement", title: "About these terms", content: <>
      <p>These terms are between you and {legalDetails.operator}, the operator of towereclipse.com and the TE Accounts connection app. They cover the website, account connections, bug tracker, and related community features. By choosing to sign in, connect an account, or submit content after being shown these terms, you agree to them. If you do not agree, do not use those features.</p>
      <p>Our <Link to="/privacy">Privacy Policy</Link> explains how we handle information. For questions or support, contact <PrivacyContact />.</p>
    </> },
    { id: "eligibility", title: "Accounts and eligibility", content: <>
      <p>You must be at least 13 to use website account features, satisfy any higher local minimum age, and meet the relevant platform’s eligibility rules. Obtain permission from a parent or guardian where required. Use only accounts you control and do not impersonate someone else.</p>
      <p>Discord server membership and roles determine website access. Linking Roblox is optional and does not grant a staff role, rewards, tournament eligibility, or ownership of game content. One Roblox identity can be connected to one website account at a time. You can manage that connection from your account page.</p>
      <p>Protect your accounts and tell us if you believe they have been misused. We do not request your Roblox or Discord password.</p>
    </> },
    { id: "conduct", title: "Acceptable use", content: <>
      <p>Be accurate and constructive when reporting issues or participating in discussions. Do not harass others, expose private information, upload unlawful or infringing material, distribute malware, impersonate others, spam, evade access restrictions, or interfere with the service.</p>
      <p>Do not exploit a discovered vulnerability against other users or public systems. Report security issues privately through our contact address, with only the information needed for us to investigate.</p>
    </> },
    { id: "contributions", title: "Your reports and contributions", content: <>
      <p>When you apply for a team opening, you permit us to store and review your answers and verified account details to assess your application and communicate about it. Provide accurate information and only submit material you have permission to share. Submission does not guarantee selection, employment, payment, or any Discord or Roblox role; the opening and any separately agreed terms determine the opportunity. You may withdraw an undecided application through your account, but withdrawal does not delete its records or allow another submission to the same opening.</p>
      <p>You retain ownership of content you submit. You grant us a non-exclusive, worldwide, royalty-free permission to store, reproduce, display, format, and use that content as needed to operate the website, investigate reports, maintain development records, and communicate about the issue. You must have the rights and permissions needed to submit it.</p>
      <p>Submitted reports, comments, attachments, and public activity may be visible to everyone. Do not submit material that must remain confidential. We may moderate, correct, archive, or remove content to maintain useful records, enforce these terms, or comply with law.</p>
      <p>A report does not guarantee a response, approval, fix, credit, compensation, or a release date. Tournament-specific rules and registration conditions apply separately when provided by the organizer.</p>
    </> },
    { id: "roblox", title: "Roblox and other platforms", content: <>
      <p>When using this app, you agree to comply with the <a href="https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use" target="_blank" rel="noopener noreferrer">Roblox Terms of Use</a>. Discord and other services also govern your use of their own platforms.</p>
      <p>These website terms are an agreement with {legalDetails.operator} only, not Roblox. Roblox is not affiliated with or an endorser of this app. Roblox is not responsible for your use of the app and has no duty to provide maintenance or support for it.</p>
      <p>To the extent permitted by applicable law, by using or accessing the app you waive and release claims, liabilities, damages, losses, and expenses against Roblox arising from or relating to the app. This does not exclude any right or remedy that cannot lawfully be excluded.</p>
      <p>Platform outages, account restrictions, or changes to an external service may affect sign-in and linking. Removing a website connection does not delete your Roblox or Discord account.</p>
    </> },
    { id: "site-content", title: "Website content", content: <>
      <p>Website designs, branding, artwork, and other materials belong to their respective owners. These terms do not transfer ownership or grant permission to redistribute them beyond rights you already have under law or a separate permission. Roblox and Discord marks belong to their respective owners.</p>
    </> },
    { id: "availability", title: "Availability and your legal rights", content: <>
      <p>Tower Eclipse is in development. Features, content, and access may change, and we cannot promise continuous availability or that every error will be corrected. We will take reasonable care in operating the service.</p>
      <p>Nothing in these terms limits consumer guarantees, privacy rights, or other protections that cannot be excluded under applicable law. These terms do not require you to give up a legal remedy available to you.</p>
    </> },
    { id: "ending-access", title: "Restrictions and ending access", content: <>
      <p>We may restrict features, remove content, or suspend access where reasonably necessary to address misuse, security risks, loss of platform eligibility, or legal requirements. You can contact us to ask about a decision or request a review.</p>
      <p>You may stop using the website, unlink Roblox, or request deletion of your website information at any time. Signing out ends the current session but does not delete contributions. Retention and deletion are explained in the <Link to="/privacy#choices">Privacy Policy</Link>.</p>
    </> },
    { id: "updates-contact", title: "Updates and contact", content: <>
      <p>We may revise these terms as the website changes. We will show the effective date and provide notice of material changes where appropriate. If a change requires renewed agreement, we will ask before applying it to the relevant feature.</p>
      <p>For support, questions, or concerns about these terms, contact <PrivacyContact />.</p>
    </> },
  ],
};
