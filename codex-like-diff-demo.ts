type User = {
  id: number;
  name: string;
  role: "admin" | "member";
};

function formatUser(user: User): string {
  const badge = user.role === "admin" ? "★" : "•";
  const roleLabel = user.role === "admin" ? "Administrator" : "Member";
  const label = `${badge} ${user.name.toUpperCase()} (#${user.id})`;
  return `${label} — ${roleLabel}`;
}

const demoUser: User = {
  id: 42,
  name: "Dani",
  role: "admin",
};

const fallbackUser: User = {
  id: 7,
  name: "Guest",
  role: "member",
};

console.log(formatUser(demoUser));
console.log(formatUser(fallbackUser));
