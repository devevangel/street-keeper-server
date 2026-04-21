import "dotenv/config";
import prisma from "../lib/prisma.js";

async function main() {
  const totalActivities = await prisma.activity.count();
  const processedActivities = await prisma.activity.count({ where: { isProcessed: true } });
  const unprocessedActivities = await prisma.activity.count({ where: { isProcessed: false } });
  const totalProjects = await prisma.project.count();
  const activeProjects = await prisma.project.count({ where: { isArchived: false } });
  const projectsWithProgress = await prisma.project.count({ where: { isArchived: false, completedStreets: { gt: 0 } } });
  const totalUsers = await prisma.user.count();
  const citySyncs = await prisma.citySync.count();
  const nodeHits = await prisma.userNodeHit.count();

  const projects = await prisma.project.findMany({
    select: { id: true, name: true, completedStreets: true, isArchived: true },
  });

  console.log("--- Database Status ---");
  console.log(`Users: ${totalUsers}`);
  console.log(`Activities: ${totalActivities} (processed: ${processedActivities}, unprocessed: ${unprocessedActivities})`);
  console.log(`Projects: ${totalProjects} (active: ${activeProjects}, with progress: ${projectsWithProgress})`);
  console.log(`City syncs: ${citySyncs}`);
  console.log(`User node hits: ${nodeHits}`);
  console.log("Projects detail:", projects);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
