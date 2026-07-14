"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPomMetadata = extractPomMetadata;
const fs = __importStar(require("fs"));
const fast_xml_parser_1 = require("fast-xml-parser");
async function extractPomMetadata(pomUri) {
    try {
        const fileContents = await fs.promises.readFile(pomUri.fsPath, 'utf8');
        const parser = new fast_xml_parser_1.XMLParser({ ignoreAttributes: false });
        const jsonObj = parser.parse(fileContents);
        const project = jsonObj.project;
        const metadata = {};
        const properties = project.properties || {};
        metadata.javaVersion =
            properties['java.version'] ||
                properties['maven.compiler.release'] ||
                properties['maven.compiler.source'] ||
                properties['maven.compiler.target'];
        if (project.parent && project.parent.artifactId === 'spring-boot-starter-parent') {
            metadata.springBootVersion = project.parent.version;
        }
        else {
            // Check dependencyManagement for Spring Boot BOM import
            const managedDeps = [].concat(project.dependencyManagement?.dependencies?.dependency || []);
            const springBootBom = managedDeps.find((d) => d.artifactId?.includes('spring-boot') || d.groupId === 'org.springframework.boot');
            if (springBootBom) {
                metadata.springBootVersion = springBootBom.version || 'detected';
            }
            else {
                // Fallback: check direct dependencies
                const directDeps = [].concat(project.dependencies?.dependency || []);
                const springBootDep = directDeps.find((d) => d.artifactId?.includes('spring-boot') || d.groupId === 'org.springframework.boot');
                if (springBootDep) {
                    metadata.springBootVersion = springBootDep.version || 'detected';
                }
            }
        }
        // Extract JUnit Version — check both dependencies and dependencyManagement
        const dependencies = [].concat(project.dependencies?.dependency || []);
        const managedDepsForJunit = [].concat(project.dependencyManagement?.dependencies?.dependency || []);
        const allDeps = [...dependencies, ...managedDepsForJunit];
        const junitDep = allDeps.find((d) => d.groupId === 'junit' || d.groupId === 'org.junit.jupiter');
        if (junitDep) {
            metadata.junitVersion = junitDep.groupId === 'junit' ? '4' : '5';
        }
        return metadata;
    }
    catch (error) {
        console.error("Failed to parse POM file metadata", error);
        return {};
    }
}
//# sourceMappingURL=extractingMetadata.js.map