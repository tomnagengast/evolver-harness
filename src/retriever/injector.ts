/**
 * Principle Injector
 *
 * Formats and injects principles into prompts and CLAUDE.md files
 * for retrieval-augmented generation.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { Principle, PrincipleScore } from '../types';

/**
 * Configuration for the PrincipleInjector
 */
export interface InjectorConfig {
  /** Include usage statistics in formatted output */
  includeStats?: boolean;

  /** Include example trace references */
  includeExamples?: boolean;

  /** Maximum length for principle text (truncate if longer) */
  maxPrincipleLength?: number;

  /** Format style for output */
  formatStyle?: 'compact' | 'detailed' | 'markdown';
}

/**
 * PrincipleInjector formats principles for injection into prompts and files
 */
export class PrincipleInjector {
  private config: InjectorConfig;

  constructor(config: InjectorConfig = {}) {
    this.config = {
      includeStats: true,
      includeExamples: false,
      maxPrincipleLength: 500,
      formatStyle: 'detailed',
      ...config,
    };
  }

  /**
   * Format principles for injection into a prompt
   */
  formatPrinciplesForPrompt(principles: Principle[] | PrincipleScore[]): string {
    if (principles.length === 0) {
      return 'No relevant principles found.';
    }

    const isPrincipleScores = this.isPrincipleScoreArray(principles);
    const output: string[] = [];

    output.push('# Learned Principles from Experience\n');
    output.push(
      'The following principles have been learned from past experiences and should guide your approach:\n'
    );

    for (let i = 0; i < principles.length; i++) {
      const item = principles[i];
      const principle = isPrincipleScores ? item.principle : item;
      const score = isPrincipleScores ? item.score : undefined;

      output.push(`\n## Principle ${i + 1}: ${this.truncateText(principle.text, 80)}\n`);

      // Full principle text
      const text = this.truncateText(principle.text, this.config.maxPrincipleLength);
      output.push(`${text}\n`);

      // Tags
      if (principle.tags.length > 0) {
        output.push(`**Tags:** ${principle.tags.join(', ')}\n`);
      }

      // Triples (structured metadata)
      if (principle.triples.length > 0 && this.config.formatStyle === 'detailed') {
        output.push('**Context:**\n');
        for (const triple of principle.triples) {
          output.push(`- ${triple.subject} ${triple.relation} ${triple.object}\n`);
        }
      }

      // Statistics
      if (this.config.includeStats) {
        const displayScore =
          score !== undefined ? score : (principle.success_count + 1) / (principle.use_count + 2);
        output.push(
          `**Effectiveness:** ${(displayScore * 100).toFixed(1)}% (${principle.success_count} successes / ${principle.use_count} uses)\n`
        );
      }

      // Examples
      if (this.config.includeExamples && principle.examples.length > 0) {
        output.push('**Examples:**\n');
        for (const example of principle.examples.slice(0, 3)) {
          output.push(`- Trace ${example.trace_id}`);
          if (example.relevance_note) {
            output.push(`: ${example.relevance_note}`);
          }
          output.push('\n');
        }
      }
    }

    return output.join('');
  }

  /**
   * Generate a CLAUDE.md section for learned principles
   */
  generateClaudeMdSection(principles: Principle[] | PrincipleScore[]): string {
    if (principles.length === 0) {
      return '';
    }

    const isPrincipleScores = this.isPrincipleScoreArray(principles);
    const output: string[] = [];

    output.push('## Learned Principles\n');
    output.push(
      '> These principles have been automatically learned from experience. They represent patterns that have proven effective in similar situations.\n'
    );

    for (let i = 0; i < principles.length; i++) {
      const item = principles[i];
      const principle = isPrincipleScores ? item.principle : item;
      const score = isPrincipleScores ? item.score : undefined;

      // Compact format for CLAUDE.md
      output.push(`\n### ${i + 1}. ${this.truncateText(principle.text, 80)}\n`);

      const text = this.truncateText(principle.text, this.config.maxPrincipleLength);
      output.push(`${text}\n`);

      // Only include tags and effectiveness in compact format
      if (principle.tags.length > 0) {
        output.push(`- **Relevant to:** ${principle.tags.join(', ')}\n`);
      }

      if (this.config.includeStats) {
        const displayScore =
          score !== undefined ? score : (principle.success_count + 1) / (principle.use_count + 2);
        output.push(
          `- **Proven effectiveness:** ${(displayScore * 100).toFixed(0)}% success rate (${principle.use_count} uses)\n`
        );
      }
    }

    return output.join('');
  }

  /**
   * Update a CLAUDE.md file with learned principles
   */
  updateClaudeMd(projectPath: string, principles: Principle[] | PrincipleScore[]): void {
    try {
      const claudeMdPath = `${projectPath}/CLAUDE.md`;
      const principlesSection = this.generateClaudeMdSection(principles);

      if (principlesSection === '') {
        console.log('No principles to inject into CLAUDE.md');
        return;
      }

      let content = '';

      // Read existing CLAUDE.md if it exists
      if (existsSync(claudeMdPath)) {
        content = readFileSync(claudeMdPath, 'utf-8');

        // Remove old learned principles section if it exists
        const startMarker = '## Learned Principles';
        const startIndex = content.indexOf(startMarker);

        if (startIndex !== -1) {
          // Find the next ## heading or end of file
          const restContent = content.substring(startIndex + startMarker.length);
          const nextHeadingMatch = restContent.match(/\n## [^#]/);

          if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
            // Remove from start marker to next heading
            const endIndex = startIndex + startMarker.length + nextHeadingMatch.index;
            content = content.substring(0, startIndex) + content.substring(endIndex);
          } else {
            // Remove from start marker to end of file
            content = content.substring(0, startIndex);
          }
        }

        // Trim trailing whitespace
        content = content.trimEnd();
      } else {
        // Create new CLAUDE.md
        content = '# CLAUDE.md\n\nProject-specific instructions for Claude.\n';
      }

      // Add new principles section
      content += '\n\n' + principlesSection.trimEnd() + '\n';

      // Write back to file
      writeFileSync(claudeMdPath, content, 'utf-8');

      console.log(`Updated ${claudeMdPath} with ${principles.length} principles`);
    } catch (error) {
      throw new Error(
        `Failed to update CLAUDE.md: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Format principles in a compact single-line format
   */
  formatCompact(principles: Principle[] | PrincipleScore[]): string {
    if (principles.length === 0) {
      return 'No principles';
    }

    const isPrincipleScores = this.isPrincipleScoreArray(principles);
    const lines: string[] = [];

    for (const item of principles) {
      const principle = isPrincipleScores ? item.principle : item;
      const score = isPrincipleScores ? item.score : undefined;

      const displayScore =
        score !== undefined ? score : (principle.success_count + 1) / (principle.use_count + 2);
      const scoreStr = `[${(displayScore * 100).toFixed(0)}%]`;
      const text = this.truncateText(principle.text, 100);
      const tags = principle.tags.length > 0 ? ` (${principle.tags.join(', ')})` : '';

      lines.push(`${scoreStr} ${text}${tags}`);
    }

    return lines.join('\n');
  }

  /**
   * Format principles as JSON
   */
  formatJson(principles: Principle[] | PrincipleScore[]): string {
    return JSON.stringify(principles, null, 2);
  }

  /**
   * Format a single principle in detail
   */
  formatPrincipleDetailed(principle: Principle): string {
    const output: string[] = [];

    output.push(`# Principle: ${principle.id}\n`);
    output.push(`## Text\n${principle.text}\n`);

    // Tags
    if (principle.tags.length > 0) {
      output.push(`\n## Tags\n${principle.tags.join(', ')}\n`);
    }

    // Triples
    if (principle.triples.length > 0) {
      output.push('\n## Structured Metadata\n');
      for (const triple of principle.triples) {
        output.push(`- ${triple.subject} → ${triple.relation} → ${triple.object}\n`);
      }
    }

    // Statistics
    const score = (principle.success_count + 1) / (principle.use_count + 2);
    output.push(`\n## Statistics\n`);
    output.push(`- **Uses:** ${principle.use_count}\n`);
    output.push(`- **Successes:** ${principle.success_count}\n`);
    output.push(`- **Score:** ${(score * 100).toFixed(1)}%\n`);
    output.push(`- **Success Rate:** ${principle.use_count > 0 ? ((principle.success_count / principle.use_count) * 100).toFixed(1) : 'N/A'}%\n`);

    // Examples
    if (principle.examples.length > 0) {
      output.push(`\n## Examples (${principle.examples.length})\n`);
      for (const example of principle.examples) {
        output.push(`- **Trace:** ${example.trace_id}\n`);
        if (example.relevance_note) {
          output.push(`  ${example.relevance_note}\n`);
        }
        if (example.similarity_score !== undefined) {
          output.push(`  Similarity: ${(example.similarity_score * 100).toFixed(1)}%\n`);
        }
      }
    }

    // Metadata
    output.push(`\n## Metadata\n`);
    output.push(`- **Created:** ${principle.created_at}\n`);
    output.push(`- **Updated:** ${principle.updated_at}\n`);
    if (principle.source) {
      output.push(`- **Source:** ${principle.source}\n`);
    }
    if (principle.version) {
      output.push(`- **Version:** ${principle.version}\n`);
    }
    if (principle.confidence) {
      output.push(`- **Confidence:** ${(principle.confidence * 100).toFixed(1)}%\n`);
    }

    return output.join('');
  }

  // Private helper methods

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  private isPrincipleScoreArray(
    principles: Principle[] | PrincipleScore[]
  ): principles is PrincipleScore[] {
    return principles.length > 0 && 'score' in principles[0] && 'principle' in principles[0];
  }
}

