# Contributing to xtb-api-unofficial

Thank you for your interest in contributing! This guide will help you get started with developing and contributing to this project.

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Git
- TypeScript knowledge
- (Optional) Chrome browser for testing browser mode

### Setup

1. **Fork and clone**
   ```bash
   git clone https://github.com/your-username/xtb-api-unofficial.git
   cd xtb-api-unofficial
   npm install
   ```

2. **Build and test**
   ```bash
   npm run build    # Compile TypeScript
   npm run lint     # Check code style
   npm test         # Run unit tests
   ```

## Development Workflow

### 1. Create a Branch

Always create a feature branch for your work:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### 2. Make Changes

- **Code Style**: Follow the existing patterns and use ESLint/Prettier
- **Documentation**: Update JSDoc comments for any new public methods
- **Types**: Ensure all TypeScript interfaces are properly typed
- **Tests**: Add unit tests for new functionality

### 3. Test Your Changes

Before submitting, ensure all checks pass:

```bash
npm run build     # Must build without errors
npm run lint      # Must pass linting
npm test          # Must pass all tests
npm run format    # Auto-fix formatting issues
```

### 4. Test with Real/Demo Account (Optional)

If your changes affect trading functionality:

```bash
# Create test file (DO NOT COMMIT)
cat > test-local.ts << 'EOF'
import { XTBClient } from './src';

const client = new XTBClient({
  mode: 'websocket',
  websocket: {
    url: 'wss://api5demoa.x-station.eu/v1/xstation', // DEMO ONLY!
    accountNumber: YOUR_DEMO_ACCOUNT,
    auth: {
      credentials: { email: 'your@demo.email', password: 'demo-password' }
    }
  }
});

// Test your changes here...
EOF

# Test (remember to delete the file after)
npx tsx test-local.ts
rm test-local.ts
```

### 5. Submit a Pull Request

```bash
git add .
git commit -m "feat: describe your changes"
git push origin feature/your-feature-name
```

Then open a PR on GitHub with:
- Clear description of what you changed
- Link to any related issues
- Screenshots/examples if applicable

## Security Guidelines

⚠️ **CRITICAL**: Never commit sensitive information!

### What to NEVER commit:
- Real account numbers (use 12345678 in examples)
- Email addresses (use user@example.com)
- Passwords or API keys
- TGT tokens or service tickets
- Personal trading data or screenshots with account info

### Safe testing:
- Always use demo accounts for development
- Use placeholder values in code examples
- Test files with real credentials should be in `.gitignore`

## Code Style

We use ESLint and Prettier for consistent code style:

### TypeScript Guidelines
- Use strict TypeScript - no `any` unless absolutely necessary
- Prefer interfaces over types for object shapes
- Add JSDoc comments to all public methods
- Use meaningful variable names

### Example:
```typescript
/**
 * Execute a buy order for the specified symbol.
 *
 * @param symbol - Symbol name (e.g., 'AAPL.US', 'CIG.PL')
 * @param volume - Number of shares/lots to buy
 * @param options - Optional trade parameters
 * @returns Promise that resolves to trade execution result
 */
async buy(symbol: string, volume: number, options?: TradeOptions): Promise<TradeResult> {
  // Implementation...
}
```

### Commit Messages
Use conventional commit format:
- `feat:` - new feature
- `fix:` - bug fix
- `docs:` - documentation changes
- `refactor:` - code refactoring
- `test:` - adding tests
- `chore:` - maintenance tasks

## Testing

### Unit Tests
- Use Vitest for unit tests
- Test files should end with `.test.ts`
- Mock external dependencies (WebSockets, HTTP requests)
- Focus on testing logic, not external API calls

### Example test:
```typescript
import { describe, it, expect } from 'vitest';
import { priceFromDecimal } from '../src/utils';

describe('priceFromDecimal', () => {
  it('should convert decimal price to scaled format', () => {
    const result = priceFromDecimal(2.62, 2);
    expect(result).toEqual({ value: 262, scale: 2 });
  });
});
```

### Integration Testing
- Use demo accounts only
- Document any required setup in test files
- Consider rate limits when testing WebSocket connections

## Documentation

### JSDoc Standards
- All public methods must have JSDoc
- Include `@param` for all parameters
- Include `@returns` for return values
- Add `@example` for complex methods
- Use `@throws` for documented error conditions

### README Updates
If your changes affect the public API:
- Update code examples in README.md
- Update the API reference table
- Add new features to the Features section

## Architecture Guidelines

### Project Structure
```
src/
  auth/          # CAS authentication
  browser/       # Chrome DevTools Protocol
  ws/            # WebSocket client
  types/         # TypeScript definitions
  client.ts      # Unified high-level API
  utils.ts       # Helper functions
```

### Design Principles
- **Unified API**: Both browser and WebSocket modes should have the same interface
- **Type Safety**: Leverage TypeScript for better developer experience
- **Error Handling**: Provide clear, actionable error messages
- **Performance**: Cache data when appropriate (like symbols)
- **Extensibility**: Design for future features without breaking changes

## Debugging

### WebSocket Issues
- Use WebSocket network tab in browser dev tools
- Check authentication flow step-by-step
- Verify Element IDs (EIDs) for subscriptions

### Browser Mode Issues
- Ensure Chrome is running with `--remote-debugging-port=9222`
- Verify xStation5 is loaded and logged in
- Check for AngularJS scope availability

### Common Gotchas
- Symbol keys need exact format: `{assetClassId}_{symbol}_{groupId}`
- Service tickets expire quickly - don't cache them
- Demo and real accounts use different WebSocket URLs
- Some operations require authentication first

## Questions?

- **Bug reports**: Open a GitHub issue with reproduction steps
- **Feature requests**: Open a GitHub issue with use case description
- **Security concerns**: Email maintainers privately (see README)
- **General questions**: Start a GitHub discussion

## Recognition

Contributors will be acknowledged in:
- README.md contributors section
- Git commit history
- Release notes for significant contributions

Thank you for helping make this project better! 🚀