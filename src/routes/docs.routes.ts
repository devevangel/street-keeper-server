/**
 * Documentation Routes
 * Serves all documentation endpoints including:
 * - Landing page (/docs)
 * - API Reference via Swagger UI (/docs/api)
 * - Architecture documentation (/docs/architecture)
 * - Type reference (/docs/types)
 * - Error reference (/docs/errors)
 * - Frontend integration guide (/docs/frontend)
 * - Engines comparison (/docs/engines)
 * - How engines work (/docs/how-engines-work)
 * - Database (/docs/database)
 */

import { Router, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { marked, Renderer } from "marked";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { swaggerSpec } from "../config/swagger.js";

const router = Router();

// ============================================
// Marked Configuration - Enable heading IDs for TOC links
// ============================================

/**
 * Convert heading text to a URL-friendly slug
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Remove multiple hyphens
    .trim();
}

// Custom renderer to add IDs to headings
const renderer = new Renderer();
renderer.heading = function ({ text, depth }: { text: string; depth: number }) {
  const id = slugify(text);
  return `<h${depth} id="${id}">${text}</h${depth}>`;
};

marked.use({ renderer });

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.join(__dirname, "..", "docs");

// ============================================
// HTML Template Helpers
// ============================================

/**
 * Navigation items for the docs sidebar
 */
const navItems = [
  { href: "/docs", label: "Home", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { href: "/docs/api", label: "API Reference", icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" },
  { href: "/docs/types", label: "Type Reference", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { href: "/docs/architecture", label: "Architecture", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
  { href: "/docs/errors", label: "Error Reference", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
  { href: "/docs/frontend", label: "Frontend Guide", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" },
  { href: "/docs/engines", label: "Engines", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  { href: "/docs/how-engines-work", label: "How Engines Work", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
  { href: "/docs/database", label: "Database", icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" },
  { href: "/docs/test-flows", label: "Test Flows", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { href: "/docs/features/milestones", label: "Milestones Feature", icon: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" },
  { href: "/docs/features/homepage-engagement", label: "Homepage Plan", icon: "M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" },
];

/**
 * Generate navigation HTML
 */
function generateNav(currentPath: string): string {
  return navItems.map(item => {
    const isActive = currentPath === item.href;
    const activeClass = isActive 
      ? "bg-blue-600 text-white" 
      : "text-gray-300 hover:bg-gray-700 hover:text-white";
    
    return `
      <a href="${item.href}" class="group flex items-center px-3 py-2 text-sm font-medium rounded-md ${activeClass}">
        <svg class="mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}" />
        </svg>
        ${item.label}
      </a>
    `;
  }).join("\n");
}

/**
 * Wrap content in the base HTML template with Tailwind + highlight.js
 */
function wrapInHtml(title: string, content: string, currentPath: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Street Keeper Docs</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/bash.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/json.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>
    tailwind.config = {
      darkMode: 'class'
    }
  </script>
  <style>
    /* Copy button styles */
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 4px 8px;
      font-size: 12px;
      background: #374151;
      border: 1px solid #4b5563;
      border-radius: 4px;
      color: #d1d5db;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s;
    }
    pre:hover .copy-btn { opacity: 1; }
    .copy-btn:hover { background: #4b5563; }
    .copy-btn.copied { background: #059669; border-color: #059669; }
    pre { position: relative; }
    .mermaid { background: #1f2937; padding: 1rem; border-radius: 0.5rem; }
    
    /* Prose styles (since Tailwind CDN doesn't include typography plugin) */
    .docs-content { color: #9ca3af; line-height: 1.75; }
    .docs-content h1 { color: #ffffff; font-size: 2.25rem; font-weight: 700; margin-top: 0; margin-bottom: 1rem; line-height: 1.2; }
    .docs-content h2 { color: #ffffff; font-size: 1.5rem; font-weight: 600; margin-top: 2rem; margin-bottom: 1rem; line-height: 1.3; border-bottom: 1px solid #374151; padding-bottom: 0.5rem; }
    .docs-content h3 { color: #ffffff; font-size: 1.25rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.75rem; line-height: 1.4; }
    .docs-content h4 { color: #ffffff; font-size: 1.125rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; }
    .docs-content p { color: #9ca3af; margin-top: 1rem; margin-bottom: 1rem; }
    .docs-content a { color: #60a5fa; text-decoration: underline; }
    .docs-content a:hover { color: #93c5fd; }
    .docs-content strong { color: #ffffff; font-weight: 600; }
    .docs-content ul, .docs-content ol { color: #9ca3af; margin-top: 1rem; margin-bottom: 1rem; padding-left: 1.5rem; }
    .docs-content li { margin-top: 0.5rem; margin-bottom: 0.5rem; }
    .docs-content ul { list-style-type: disc; }
    .docs-content ol { list-style-type: decimal; }
    .docs-content code { color: #fbbf24; background-color: #374151; padding: 2px 6px; border-radius: 4px; font-size: 0.875rem; }
    .docs-content pre { background-color: #1f2937; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-top: 1rem; margin-bottom: 1rem; }
    .docs-content pre code { background-color: transparent; padding: 0; color: inherit; }
    .docs-content blockquote { border-left: 4px solid #4b5563; padding-left: 1rem; margin-left: 0; color: #9ca3af; font-style: italic; }
    .docs-content hr { border-color: #374151; margin-top: 2rem; margin-bottom: 2rem; }
    .docs-content table { width: 100%; border-collapse: collapse; margin-top: 1rem; margin-bottom: 1rem; }
    .docs-content th { color: #ffffff; text-align: left; padding: 0.75rem; border-bottom: 2px solid #4b5563; font-weight: 600; }
    .docs-content td { color: #9ca3af; padding: 0.75rem; border-bottom: 1px solid #374151; }
    .docs-content tr:hover { background-color: #1f2937; }
  </style>
</head>
<body class="h-full bg-gray-900">
  <div class="flex h-full">
    <!-- Sidebar -->
    <div class="hidden md:flex md:w-64 md:flex-col">
      <div class="flex min-h-0 flex-1 flex-col bg-gray-800">
        <div class="flex flex-1 flex-col overflow-y-auto pt-5 pb-4">
          <div class="flex flex-shrink-0 items-center px-4">
            <span class="text-xl font-bold text-white">Street Keeper</span>
          </div>
          <nav class="mt-8 flex-1 space-y-1 px-2">
            ${generateNav(currentPath)}
          </nav>
        </div>
        <div class="flex flex-shrink-0 bg-gray-700 p-4">
          <div class="text-sm text-gray-400">
            API Version: 1.0.0
          </div>
        </div>
      </div>
    </div>

    <!-- Main content -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <!-- Mobile header -->
      <div class="md:hidden bg-gray-800 px-4 py-3">
        <span class="text-lg font-bold text-white">Street Keeper Docs</span>
      </div>
      
      <!-- Content area -->
      <main class="flex-1 overflow-y-auto bg-gray-900">
        <div class="py-8 px-4 sm:px-6 lg:px-8">
          <div class="docs-content max-w-4xl mx-auto">
            ${content}
          </div>
        </div>
      </main>
    </div>
  </div>

  <script>
    // Initialize highlight.js
    hljs.highlightAll();
    
    // Initialize Mermaid
    mermaid.initialize({ 
      startOnLoad: true, 
      theme: 'dark',
      themeVariables: {
        primaryColor: '#3b82f6',
        primaryTextColor: '#f9fafb',
        primaryBorderColor: '#4b5563',
        lineColor: '#6b7280',
        secondaryColor: '#1f2937',
        tertiaryColor: '#374151'
      }
    });

    // Add copy buttons to all code blocks
    document.querySelectorAll('pre code').forEach((block) => {
      const pre = block.parentElement;
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.onclick = async () => {
        await navigator.clipboard.writeText(block.textContent);
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      };
      pre.appendChild(btn);
    });
  </script>
</body>
</html>`;
}

/**
 * Read and parse a markdown file
 */
function readMarkdownFile(filename: string): string {
  const filePath = path.join(docsDir, filename);
  if (!fs.existsSync(filePath)) {
    return `<p class="text-red-400">Documentation file not found: ${filename}</p>`;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return marked.parse(content) as string;
}

// ============================================
// Landing Page
// ============================================

/**
 * GET /docs
 * Landing page with project overview and navigation
 */
router.get("/", (req: Request, res: Response) => {
  const landingContent = `
    <div class="text-center mb-12">
      <h1 class="text-4xl font-bold text-white mb-4">Street Keeper API Documentation</h1>
      <p class="text-xl text-gray-400">A fitness tracking API that processes GPS data from Strava to track street coverage for runners.</p>
      <p class="mt-4"><a href="/docs/index" class="text-blue-400 hover:underline">Full documentation index</a></p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
      <a href="/docs/api" class="block p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">API Reference</h2>
        </div>
        <p class="text-gray-400">Interactive Swagger UI documentation with all endpoints, request/response schemas, and examples.</p>
      </a>

      <a href="/docs/types" class="block p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">Type Reference</h2>
        </div>
        <p class="text-gray-400">Complete TypeScript interface definitions for all API request and response types.</p>
      </a>

      <a href="/docs/architecture" class="block p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">Architecture</h2>
        </div>
        <p class="text-gray-400">System design, data flow diagrams, and detailed explanations of architectural decisions.</p>
      </a>

      <a href="/docs/errors" class="block p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">Error Reference</h2>
        </div>
        <p class="text-gray-400">Complete list of error codes, HTTP status mappings, and error handling best practices.</p>
      </a>

      <a href="/docs/frontend" class="block p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">Frontend Guide</h2>
        </div>
        <p class="text-gray-400">Copy-paste ready code examples for React + TypeScript integration with fetch and axios.</p>
      </a>

      <a href="/docs/engines" class="block p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">Engines (V1 vs V2)</h2>
        </div>
        <p class="text-gray-400">Compare the V1 (Overpass + Mapbox) and V2 (node proximity) GPX analysis engines, endpoints, progress storage, and configuration.</p>
      </a>

      <a href="/docs/how-engines-work" class="block p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">How the Engines Work</h2>
        </div>
        <p class="text-gray-400">Plain-English guide to GPX, PBF, V1 and V2 pipelines, street matching, and how each layer works from upload to output.</p>
      </a>

      <a href="/docs/database" class="block p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">Database</h2>
        </div>
        <p class="text-gray-400">Plain-English guide to all 12 Prisma models: User, Project, Activity, UserStreetProgress, UserNodeHit, WayCache, and more. Relationships, design choices, and analogies.</p>
      </a>

      <a href="/docs/test-flows" class="block p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors border-2 border-emerald-600">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">App Test Flows</h2>
        </div>
        <p class="text-gray-400">Complete test flows for every feature: authentication, homepage, projects, milestones, GPX analysis, activity pipeline, and all API endpoints.</p>
      </a>

      <a href="/docs/features/milestones" class="block p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">Milestones Feature</h2>
        </div>
        <p class="text-gray-400">Full vision for the milestones &amp; goals system: behavioral research, all 6 phases, message engine, celebration UX, and implementation details.</p>
      </a>

      <a href="/docs/features/homepage-engagement" class="block p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">Homepage Plan</h2>
        </div>
        <p class="text-gray-400">Homepage design rationale, engagement strategy, dynamic hero states, suggestion engine, streaks, and behavioral patterns driving retention.</p>
      </a>

      <div class="block p-6 bg-gray-800 rounded-lg border-2 border-dashed border-gray-600">
        <div class="flex items-center mb-4">
          <svg class="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 class="ml-3 text-xl font-semibold text-white">Quick Start</h2>
        </div>
        <p class="text-gray-400 mb-4">Get started with the API in minutes.</p>
        <code class="text-sm bg-gray-700 px-2 py-1 rounded">curl http://localhost:8000/health</code>
      </div>
    </div>

    <div class="bg-gray-800 rounded-lg p-6 mb-12">
      <h2 class="text-2xl font-bold text-white mb-4">Tech Stack</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="text-center p-4 bg-gray-700 rounded">
          <div class="text-2xl font-bold text-blue-400">Express 5</div>
          <div class="text-gray-400 text-sm">Web Framework</div>
        </div>
        <div class="text-center p-4 bg-gray-700 rounded">
          <div class="text-2xl font-bold text-blue-400">TypeScript</div>
          <div class="text-gray-400 text-sm">Language</div>
        </div>
        <div class="text-center p-4 bg-gray-700 rounded">
          <div class="text-2xl font-bold text-blue-400">Prisma</div>
          <div class="text-gray-400 text-sm">ORM</div>
        </div>
        <div class="text-center p-4 bg-gray-700 rounded">
          <div class="text-2xl font-bold text-blue-400">PostgreSQL</div>
          <div class="text-gray-400 text-sm">Database</div>
        </div>
      </div>
    </div>

    <div class="bg-gray-800 rounded-lg p-6">
      <h2 class="text-2xl font-bold text-white mb-4">API Endpoints Overview</h2>
      <div class="overflow-x-auto">
        <table class="min-w-full">
          <thead>
            <tr class="border-b border-gray-700">
              <th class="text-left py-3 px-4 text-gray-300">Method</th>
              <th class="text-left py-3 px-4 text-gray-300">Endpoint</th>
              <th class="text-left py-3 px-4 text-gray-300">Description</th>
              <th class="text-left py-3 px-4 text-gray-300">Auth</th>
            </tr>
          </thead>
          <tbody class="text-gray-400">
            <tr class="border-b border-gray-700">
              <td class="py-3 px-4"><span class="bg-blue-600 text-white px-2 py-1 rounded text-xs">GET</span></td>
              <td class="py-3 px-4 font-mono text-sm">/auth/strava</td>
              <td class="py-3 px-4">Initiate Strava OAuth</td>
              <td class="py-3 px-4">No</td>
            </tr>
            <tr class="border-b border-gray-700">
              <td class="py-3 px-4"><span class="bg-blue-600 text-white px-2 py-1 rounded text-xs">GET</span></td>
              <td class="py-3 px-4 font-mono text-sm">/activities</td>
              <td class="py-3 px-4">List user's activities</td>
              <td class="py-3 px-4">Yes</td>
            </tr>
            <tr class="border-b border-gray-700">
              <td class="py-3 px-4"><span class="bg-green-600 text-white px-2 py-1 rounded text-xs">POST</span></td>
              <td class="py-3 px-4 font-mono text-sm">/runs/analyze-gpx</td>
              <td class="py-3 px-4">Upload and analyze GPX file (legacy)</td>
              <td class="py-3 px-4">No</td>
            </tr>
            <tr class="border-b border-gray-700">
              <td class="py-3 px-4"><span class="bg-blue-600 text-white px-2 py-1 rounded text-xs">GET</span></td>
              <td class="py-3 px-4 font-mono text-sm">/engine-v1</td>
              <td class="py-3 px-4">Engine V1 info</td>
              <td class="py-3 px-4">No</td>
            </tr>
            <tr class="border-b border-gray-700">
              <td class="py-3 px-4"><span class="bg-green-600 text-white px-2 py-1 rounded text-xs">POST</span></td>
              <td class="py-3 px-4 font-mono text-sm">/engine-v1/analyze</td>
              <td class="py-3 px-4">Analyze GPX (V1)</td>
              <td class="py-3 px-4">No</td>
            </tr>
            <tr class="border-b border-gray-700">
              <td class="py-3 px-4"><span class="bg-blue-600 text-white px-2 py-1 rounded text-xs">GET</span></td>
              <td class="py-3 px-4 font-mono text-sm">/engine-v2</td>
              <td class="py-3 px-4">Engine V2 info</td>
              <td class="py-3 px-4">No</td>
            </tr>
            <tr class="border-b border-gray-700">
              <td class="py-3 px-4"><span class="bg-blue-600 text-white px-2 py-1 rounded text-xs">GET</span></td>
              <td class="py-3 px-4 font-mono text-sm">/engine-v2/streets</td>
              <td class="py-3 px-4">User streets (V2)</td>
              <td class="py-3 px-4">Yes</td>
            </tr>
            <tr class="border-b border-gray-700">
              <td class="py-3 px-4"><span class="bg-blue-600 text-white px-2 py-1 rounded text-xs">GET</span></td>
              <td class="py-3 px-4 font-mono text-sm">/engine-v2/map/streets</td>
              <td class="py-3 px-4">Map streets (V2)</td>
              <td class="py-3 px-4">Yes</td>
            </tr>
            <tr class="border-b border-gray-700">
              <td class="py-3 px-4"><span class="bg-green-600 text-white px-2 py-1 rounded text-xs">POST</span></td>
              <td class="py-3 px-4 font-mono text-sm">/engine-v2/analyze</td>
              <td class="py-3 px-4">Analyze GPX (V2)</td>
              <td class="py-3 px-4">No (userId query)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-4 text-gray-400 text-sm">See <a href="/docs/api" class="text-blue-400 hover:underline">API Reference</a> for complete endpoint documentation.</p>
    </div>
  `;
  
  res.send(wrapInHtml("Home", landingContent, "/docs"));
});

// ============================================
// Swagger UI (API Reference)
// ============================================

/**
 * GET /docs/api
 * Swagger UI for interactive API documentation
 */
router.use("/api", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: `
    .swagger-ui .topbar { display: none; }
    .swagger-ui { background: #111827; }
    .swagger-ui .info .title { color: #f9fafb; }
    .swagger-ui .info .description p { color: #d1d5db; }
    .swagger-ui .scheme-container { background: #1f2937; box-shadow: none; }
    .swagger-ui .opblock-tag { color: #f9fafb; border-bottom-color: #374151; }
    .swagger-ui .opblock { background: #1f2937; border-color: #374151; }
    .swagger-ui .opblock .opblock-summary { border-color: #374151; }
    .swagger-ui .opblock .opblock-summary-description { color: #d1d5db; }
    .swagger-ui .opblock .opblock-section-header { background: #374151; }
    .swagger-ui .opblock .opblock-section-header h4 { color: #f9fafb; }
    .swagger-ui table thead tr th { color: #f9fafb; border-bottom-color: #374151; }
    .swagger-ui table tbody tr td { color: #d1d5db; border-bottom-color: #374151; }
    .swagger-ui .parameter__name { color: #f9fafb; }
    .swagger-ui .parameter__type { color: #60a5fa; }
    .swagger-ui .model-title { color: #f9fafb; }
    .swagger-ui .model { color: #d1d5db; }
    .swagger-ui .model-box { background: #1f2937; }
    .swagger-ui section.models { border-color: #374151; }
    .swagger-ui section.models h4 { color: #f9fafb; }
    .swagger-ui .response-col_status { color: #f9fafb; }
    .swagger-ui .response-col_description { color: #d1d5db; }
    .swagger-ui .btn { background: #374151; color: #f9fafb; border-color: #4b5563; }
    .swagger-ui .btn:hover { background: #4b5563; }
    .swagger-ui select { background: #374151; color: #f9fafb; border-color: #4b5563; }
    .swagger-ui input[type=text] { background: #374151; color: #f9fafb; border-color: #4b5563; }
    .swagger-ui textarea { background: #374151; color: #f9fafb; border-color: #4b5563; }
  `,
  customSiteTitle: "Street Keeper API Reference",
}));

// ============================================
// Architecture Documentation
// ============================================

/**
 * GET /docs/architecture
 * System architecture and design decisions
 */
router.get("/architecture", (req: Request, res: Response) => {
  const content = readMarkdownFile("ARCHITECTURE.md");
  res.send(wrapInHtml("Architecture", content, "/docs/architecture"));
});

// ============================================
// Engines Documentation
// ============================================

/**
 * GET /docs/engines
 * V1 vs V2 engine comparison and configuration
 */
router.get("/engines", (req: Request, res: Response) => {
  const content = readMarkdownFile("ENGINE_COMPARISON.md");
  res.send(wrapInHtml("Engines", content, "/docs/engines"));
});

// ============================================
// How Engines Work (plain-English guide)
// ============================================

/**
 * GET /docs/how-engines-work
 * Plain-English guide to GPX, PBF, V1/V2 pipelines, and street matching
 */
router.get("/how-engines-work", (req: Request, res: Response) => {
  const content = readMarkdownFile("HOW_ENGINES_WORK.md");
  res.send(wrapInHtml("How the Engines Work", content, "/docs/how-engines-work"));
});

// ============================================
// Database Documentation
// ============================================

/**
 * GET /docs/database
 * Plain-English guide to all 12 Prisma models, relationships, and design choices
 */
router.get("/database", (req: Request, res: Response) => {
  const content = readMarkdownFile("DATABASE.md");
  res.send(wrapInHtml("Database", content, "/docs/database"));
});

// ============================================
// Type Reference
// ============================================

/**
 * GET /docs/types
 * TypeScript type definitions reference
 */
router.get("/types", (req: Request, res: Response) => {
  const content = readMarkdownFile("TYPES_REFERENCE.md");
  res.send(wrapInHtml("Type Reference", content, "/docs/types"));
});

// ============================================
// Error Reference
// ============================================

/**
 * GET /docs/errors
 * Error codes and handling guide
 */
router.get("/errors", (req: Request, res: Response) => {
  const content = readMarkdownFile("ERROR_REFERENCE.md");
  res.send(wrapInHtml("Error Reference", content, "/docs/errors"));
});

// ============================================
// Frontend Integration Guide
// ============================================

/**
 * GET /docs/frontend
 * Copy-paste ready frontend code examples
 */
router.get("/frontend", (req: Request, res: Response) => {
  const content = readMarkdownFile("FRONTEND_GUIDE.md");
  res.send(wrapInHtml("Frontend Integration Guide", content, "/docs/frontend"));
});

// ============================================
// Additional documentation routes
// ============================================

router.get("/index", (req: Request, res: Response) => {
  const content = readMarkdownFile("INDEX.md");
  res.send(wrapInHtml("Documentation Index", content, "/docs/index"));
});
router.get("/getting-started", (req: Request, res: Response) => {
  const content = readMarkdownFile("GETTING_STARTED.md");
  res.send(wrapInHtml("Getting Started", content, "/docs/getting-started"));
});
router.get("/api-reference", (req: Request, res: Response) => {
  const content = readMarkdownFile("API_REFERENCE.md");
  res.send(wrapInHtml("API Reference", content, "/docs/api-reference"));
});
router.get("/gpx-street-analysis", (req: Request, res: Response) => {
  const content = readMarkdownFile("GPX_STREET_ANALYSIS.md");
  res.send(wrapInHtml("GPX Street Analysis", content, "/docs/gpx-street-analysis"));
});
router.get("/map-feature", (req: Request, res: Response) => {
  const content = readMarkdownFile("MAP_FEATURE.md");
  res.send(wrapInHtml("Map Feature", content, "/docs/map-feature"));
});
router.get("/strava-integration", (req: Request, res: Response) => {
  const content = readMarkdownFile("STRAVA_INTEGRATION.md");
  res.send(wrapInHtml("Strava Integration", content, "/docs/strava-integration"));
});
router.get("/background-jobs", (req: Request, res: Response) => {
  const content = readMarkdownFile("BACKGROUND_JOBS.md");
  res.send(wrapInHtml("Background Jobs", content, "/docs/background-jobs"));
});
router.get("/scripts", (req: Request, res: Response) => {
  const content = readMarkdownFile("SCRIPTS.md");
  res.send(wrapInHtml("Scripts", content, "/docs/scripts"));
});
router.get("/coding-patterns", (req: Request, res: Response) => {
  const content = readMarkdownFile("CODING_PATTERNS.md");
  res.send(wrapInHtml("Coding Patterns", content, "/docs/coding-patterns"));
});
router.get("/glossary", (req: Request, res: Response) => {
  const content = readMarkdownFile("GLOSSARY.md");
  res.send(wrapInHtml("Glossary", content, "/docs/glossary"));
});
router.get("/troubleshooting", (req: Request, res: Response) => {
  const content = readMarkdownFile("TROUBLESHOOTING.md");
  res.send(wrapInHtml("Troubleshooting", content, "/docs/troubleshooting"));
});
router.get("/engines-overview", (req: Request, res: Response) => {
  const content = readMarkdownFile("ENGINES.md");
  res.send(wrapInHtml("Engines Overview", content, "/docs/engines-overview"));
});

// ============================================
// Feature Documentation
// ============================================

/**
 * GET /docs/test-flows
 * Comprehensive test flows and feature reference for the entire app
 */
router.get("/test-flows", (req: Request, res: Response) => {
  const content = readMarkdownFile("APP_TEST_FLOWS.md");
  res.send(wrapInHtml("App Test Flows", content, "/docs/test-flows"));
});

/**
 * GET /docs/features/milestones
 * Milestones & Goals feature documentation (full vision + behavioral research)
 */
router.get("/features/milestones", (req: Request, res: Response) => {
  const content = readMarkdownFile("features/MILESTONES_GOALS_FEATURE.md");
  res.send(wrapInHtml("Milestones & Goals Feature", content, "/docs/features/milestones"));
});

/**
 * GET /docs/features/homepage-engagement
 * Homepage & Engagement plan documentation
 */
router.get("/features/homepage-engagement", (req: Request, res: Response) => {
  const filePath = path.join(docsDir, "..", "..", "..", "docs", "HOMEPAGE_AND_ENGAGEMENT_PLAN.md");
  if (!fs.existsSync(filePath)) {
    res.send(wrapInHtml("Homepage & Engagement", "<p class='text-red-400'>File not found</p>", "/docs/features/homepage-engagement"));
    return;
  }
  const content = marked.parse(fs.readFileSync(filePath, "utf-8")) as string;
  res.send(wrapInHtml("Homepage & Engagement Plan", content, "/docs/features/homepage-engagement"));
});

export default router;
