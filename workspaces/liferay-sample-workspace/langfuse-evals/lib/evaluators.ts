import type { Evaluator } from "@langfuse/client";

export const skillsInvokedEvaluator: Evaluator = async ({ expectedOutput, output }) => {
    const actualSkillsInvoked = [...output.skillsInvoked];
    const expectedSkillsInvoked = [...expectedOutput.skillsInvoked];

    actualSkillsInvoked.sort();
    expectedSkillsInvoked.sort();

    if (actualSkillsInvoked.join() !== expectedSkillsInvoked.join()) {
        return {
            name: "skillsInvoked",
            value: 0.0,
            comment: "incorrect skill(s) invoked: " + actualSkillsInvoked,
        };
    }

    return {
        name: "skillsInvoked",
        value: 1.0,
        comment: "correct skill(s) invoked",
    };
};
