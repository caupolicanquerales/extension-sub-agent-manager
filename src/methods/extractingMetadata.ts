import * as vscode from 'vscode';
import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { PomMetadata } from '../interfaces/interfaces';

export async function extractPomMetadata(pomUri: vscode.Uri): Promise<PomMetadata> {
    try {
        const fileContents = await fs.promises.readFile(pomUri.fsPath, 'utf8');
       
        const parser = new XMLParser({ ignoreAttributes: false });
        const jsonObj = parser.parse(fileContents);
        const project = jsonObj.project;
       
        const metadata: PomMetadata = {};
       
        const properties = project.properties || {};
        metadata.javaVersion =
            properties['java.version'] ||
            properties['maven.compiler.release'] ||
            properties['maven.compiler.source'] ||
            properties['maven.compiler.target'];

        if (project.parent && project.parent.artifactId === 'spring-boot-starter-parent') {
            metadata.springBootVersion = project.parent.version;
        } else {
            // Check dependencyManagement for Spring Boot BOM import
            const managedDeps: any[] = ([] as any[]).concat(project.dependencyManagement?.dependencies?.dependency || []);
            const springBootBom = managedDeps.find((d: any) =>
                d.artifactId?.includes('spring-boot') || d.groupId === 'org.springframework.boot'
            );
            if (springBootBom) {
                metadata.springBootVersion = springBootBom.version || 'detected';
            } else {
                // Fallback: check direct dependencies
                const directDeps: any[] = ([] as any[]).concat(project.dependencies?.dependency || []);
                const springBootDep = directDeps.find((d: any) =>
                    d.artifactId?.includes('spring-boot') || d.groupId === 'org.springframework.boot'
                );
                if (springBootDep) {
                    metadata.springBootVersion = springBootDep.version || 'detected';
                }
            }
        }

        // Extract JUnit Version — check both dependencies and dependencyManagement
        const dependencies: any[] = ([] as any[]).concat(project.dependencies?.dependency || []);
        const managedDepsForJunit: any[] = ([] as any[]).concat(project.dependencyManagement?.dependencies?.dependency || []);
        const allDeps: any[] = [...dependencies, ...managedDepsForJunit];
        const junitDep = allDeps.find((d: any) => d.groupId === 'junit' || d.groupId === 'org.junit.jupiter');
        if (junitDep) {
            metadata.junitVersion = junitDep.groupId === 'junit' ? '4' : '5';
        }

        return metadata;
    } catch (error) {
        console.error("Failed to parse POM file metadata", error);
        return {};
    }
}